import { Injectable, Logger } from "#nestjs/common";
import { BlandSmsService } from "@calendly/bland-sms/mod.ts";
import { LeadOrchestratorService } from "@leadorchestrator/mod.ts";
import { AbTestService } from "@sms-flow/ab-test/mod.ts";
import { CrmService } from "@sms-flow/crm/mod.ts";
import { SmsFlowStateService } from "@sms-flow/kv/mod.ts";
import { RateLimiterService } from "@sms-flow/rate-limiter/mod.ts";
import { DOMAIN_CONFIG } from "@sms-flow/readymode/config/mod.ts";
import {
  DialerDomain,
  ReadymodeLeadDto,
  ReadymodeResponseDto,
} from "@sms-flow/readymode/dto/mod.ts";
import { ReadymodeMappingService } from "@sms-flow/readymode/mapping/mod.ts";

// CONFIGURABLE PATHWAY ID - Version is now forced to PRODUCTION below
const BLAND_SMS_PATHWAY_ID = Deno.env.get("BLAND_SMS_PATHWAY_ID") ||
  "d6bd66a2-13b4-4365-a994-842c705e22b1";

@Injectable()
export class ReadymodeService {
  private readonly logger = new Logger(ReadymodeService.name);

  constructor(
    private readonly limiter: RateLimiterService,
    private readonly orchestrator: LeadOrchestratorService,
    private readonly bland: BlandSmsService,
    private readonly crm: CrmService,
    private readonly state: SmsFlowStateService,
    private readonly abTest: AbTestService,
    private readonly mapping: ReadymodeMappingService,
  ) {}

  // --- INBOUND TRIGGER LOGIC ---
  async processInboundLead(rawData: any) {
    console.log(`[Trigger] 📥 Incoming Request: ${JSON.stringify(rawData)}`);

    // 1. Extract Domain
    let domainInput = (rawData.dialerDomain || rawData.domain || "").toLowerCase().trim();
    let domain: DialerDomain;

    switch (domainInput) {
      case "monsterrg":
      case "readymodemonster":
        domain = DialerDomain.MONSTER;
        break;
      case "monsterodr":
      case "readymodeodr":
        domain = DialerDomain.ODR;
        break;
      case "monsteract":
        domain = DialerDomain.ACT;
        break;
      case "monsterds":
        domain = DialerDomain.DS;
        break;
      case "monsterods":
        domain = DialerDomain.ODS;
        break;
      default:
        console.warn(`[Trigger] Unknown dialerDomain '${domainInput}', defaulting to MONSTER`);
        domain = DialerDomain.MONSTER;
    }

    // 2. Normalize Data
    const lead = this.mapping.normalize(domain, rawData);
    const phone = lead.phone ||
      (rawData.primaryPhone ? String(rawData.primaryPhone).replace(/\D/g, "") : "");
    const resIdString = lead.reservationId || String(rawData.resID || rawData.Custom_56 || "");
    const attempts = Number(rawData.attempts || rawData.times_called || 0);

    if (!phone) {
      console.error(`[Trigger] Rejecting request: No phone number found.`);
      return { status: "error", message: "Missing phone number" };
    }

    // --- 🚨 DETERMINE OVERRIDE STATUS ---
    // Strictly checks for 'override' parameter (string "true" or boolean true)
    const isOverride = String(rawData.override).toLowerCase() === "true" ||
      rawData.override === true;

    if (isOverride) {
      console.log(`[Trigger] 🚨 OVERRIDE DETECTED: Bypassing DNC, Rate Limits, and Global Caps.`);
    }

    console.log(
      `[Trigger] Processing ${phone} (ResID: ${resIdString}) from ${domainInput} mapped to ${domain} | Attempts: ${attempts}`,
    );

    // --- GATEKEEPER 1: ATTEMPT LIMIT (40+) ---
    // Skipped if Override is TRUE
    if (!isOverride && attempts < 40) {
      console.warn(
        `[Trigger] 🛑 SKIPPED: Lead ${phone} has only ${attempts} attempts (40 required)`,
      );
      return { status: "skipped", reason: "Insufficient attempts", attempts };
    }

    // --- GATEKEEPER 2: GLOBAL DAILY LIMIT (100) ---
    // Skipped if Override is TRUE
    if (!isOverride) {
      const dailyCount = await this.getGlobalDailyCount();
      console.log(`[Trigger] 📊 Global SMS Count BEFORE Send: ${dailyCount} / 100`);

      if (dailyCount >= 100) {
        console.warn(`[Trigger] 🛑 SKIPPED: Global daily limit of 100 reached.`);
        return { status: "skipped", reason: "Global Daily Limit Reached" };
      }
    }

    // 3. CRM Check
    const resIdNum = Number(resIdString);
    console.log(`[Trigger] Checking CRM for ResID: ${resIdNum}`);
    const guest = await this.crm.findGuestByResId(resIdNum);

    if (!guest) {
      console.warn(`[Trigger] Guest not found for ResID ${resIdString}. skipping.`);
      return { status: "skipped", reason: "Guest Not Found" };
    }

    console.log(
      `[CRM Lookup] ResID: ${resIdString} | Guest: ${guest.GuestFullName} | DNC: ${guest.Dnc}`,
    );

    // --- CRM DNC CHECK (QB field 457) ---
    if (guest.Dnc) {
      console.warn(`[Trigger] 🛑 BLOCKED - Guest ${phone} (ResID: ${resIdString}) is marked DNC in QB`);
      return { status: "skipped", reason: "DNC" };
    }

    // --- NEW: OPT-OUT / DNC CHECK via STATE Service ---
    // Skipped if Override is TRUE
    if (!isOverride) {
      console.log(`[Trigger] Checking DNC Status for ${phone}...`);
      const isOptedOut = await this.state.checkIfOptedOut(phone);
      if (isOptedOut) {
        console.warn(`[Trigger] BLOCKED - Guest ${phone} has opted out (doNotText = true)`);
        return { status: "skipped", reason: "Opted Out" };
      }
    } else {
      console.log(`[Trigger] 🛡️ DNC Check BYPASSED (Override=true)`);
    }

    // 4. Rate Limit Check (30-Day Default)
    // Skipped if Override is TRUE
    if (!isOverride) {
      console.log(`[Trigger] Checking 30-day rate limit for ${phone}...`);
      const allowed = await this.limiter.checkOnly(phone);
      if (!allowed) {
        console.warn(`[Trigger] Rate limit hit for ${phone} (Last 30 days)`);
        return { status: "skipped", reason: "Rate Limited" };
      }
    } else {
      console.log(`[Trigger] 🛡️ Rate Limit Check BYPASSED (Override=true)`);
    }

    // 5. Save Context - NOW WITH ENRICHED NAMES FROM CRM
    const contextData: any = {
      domain: domain,
      campaignId: rawData.campaign || "unknown",
      reservationId: resIdString,
      ...lead,
      firstName: guest.GuestFullName || "Guest",
      lastName: guest.SpouseName || guest.SpouseFullName || "",
    };

    await this.state.saveContext(phone, contextData);

    // 6. Orchestrator Sync
    await this.orchestrator.updatePointer(phone, {
      originalSource: {
        domain: domain,
        campaignId: rawData.campaign || "unknown",
        timestamp: Date.now(),
      },
      status: "ACTIVE",
    });

    // --- AB VARIANT TOGGLE ---
    const variant = await this.getAndToggleVariant();
    const blandPhone = phone.length === 10 ? `+1${phone}` : `+${phone}`;

    // --- FETCH HISTORY CONTEXT via STATE Service ---
    let historyContext = "No previous conversations.";
    let msgCount = 0;
    try {
      console.log(`[Trigger] 🔍 Fetching history for ${phone}...`);
      const history = await this.state.getHistoryContext(phone);
      historyContext = history.contextString;
      msgCount = history.count;
      console.log(
        `[Trigger] 📜 History Result -> Count: ${msgCount} | Context Length: ${historyContext.length} chars`,
      );
    } catch (e: any) {
      console.warn(`[Trigger] ❌ Failed to fetch history: ${e.message}`);
    }

    try {
      // 7. Send SMS via Bland
      console.log(
        `[Trigger] Sending SMS to ${blandPhone} using pathway: ${BLAND_SMS_PATHWAY_ID} (FORCED PRODUCTION)`,
      );

      console.log(`[Trigger] 📧 EmailAddress from CRM: "${guest.EmailAddress || ""}"`);
      console.log(`[Trigger] 👤 GuestFullNameFormula from CRM: "${guest.GuestFullName || ""}"`);

      const blandResult = await this.bland.createConversation({
        user_number: blandPhone,
        agent_number: "+18435488335",
        pathway_id: BLAND_SMS_PATHWAY_ID,
        pathway_version: "production",
        new_conversation: true,
        request_data: {
          EmailAddress: guest.EmailAddress || "",
          GuestFullNameFormula: guest.GuestFullName || "",
          guestName: guest.GuestFullName,
          guestPhone: blandPhone, // Explicit guest phone to avoid Bland's flip-flopping user_number/agent_number
          ReservationCustomerFirstName: guest.GuestFullName?.split(" ")[0] || guest.GuestFullName,
          reservationId: resIdString,
          variant: variant,
          destination: lead.destination || rawData.desiredDestination1 || "",
          MostRecentPackageIdDateOfBooking: guest.MostRecentPackageIdDateOfBooking,
          MostRecentPackageIdCreditCardType: guest.MostRecentPackageIdCreditCardType,
          MostRecentPackageIdLast4OfCreditCardOnly: guest.MostRecentPackageIdLast4OfCreditCardOnly,
          conversationHistory: historyContext,
          previousMessageCount: msgCount,
          agentLogin: rawData.agentLogin || "API",
          gatewayTag: rawData.gatewayTag || "Readymode",
        },
      });

      console.log(`[Trigger] ✅ Bland API call successful`);

      // Fire-and-forget: fetch first AGENT message from Bland after a short delay and store in KV
      const conversationId = blandResult?.data?.conversation_id;
      if (conversationId) {
        this.storeInitialBlandMessage(phone, conversationId).catch(() => {});
      }

      await this.incrementGlobalDailyCount();
      await this.limiter.reserve(phone);

      console.log(
        `[Trigger] ✅ SMS Sent to ${blandPhone} (Variant ${variant}) and Rate Limit Updated.`,
      );
      return { status: "success", variant };
    } catch (e: any) {
      console.error(`[Trigger] Bland API Failed: ${e.message}`);
      return { status: "error", message: "Bland API Failed" };
    }
  }

  // --- HELPERS (Now using State Service) ---

  /** Returns YYYY-MM-DD in US/Eastern time so the day boundary matches business hours. */
  private getLocalDateKey(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }

  private async getGlobalDailyCount(): Promise<number> {
    try {
      const today = this.getLocalDateKey();
      const value = await this.state.get<number>(["global_sms_count", today]);
      return value || 0;
    } catch (e) {
      console.error("Error reading global count", e);
      return 0;
    }
  }

  private async incrementGlobalDailyCount(): Promise<void> {
    try {
      const today = this.getLocalDateKey();
      const current = (await this.state.get<number>(["global_sms_count", today])) || 0;
      const newCount = current + 1;
      await this.state.set(["global_sms_count", today], newCount);
      console.log(`[Trigger] 📊 Global SMS Count UPDATED: ${newCount} / 100`);
    } catch (e) {
      console.error("Error incrementing global count", e);
    }
  }

  private async getAndToggleVariant(): Promise<string> {
    try {
      const current = (await this.state.get<string>(["ab_variant_current"])) === "B" ? "B" : "A";
      const next = current === "A" ? "B" : "A";
      await this.state.set(["ab_variant_current"], next);
      console.log(`[AB Test] Lead gets: ${current} | Next flipped to: ${next}`);
      return current;
    } catch (e) {
      console.error("Error toggling variant", e);
      return "A";
    }
  }

  // --- INITIAL MESSAGE STORAGE ---

  private async storeInitialBlandMessage(phone: string, conversationId: string): Promise<void> {
    // Wait 5s for Bland to actually send the first message before fetching
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const apiKey = Deno.env.get("BLAND_API_KEY") ?? Deno.env.get("NU_BLAND_API_KEY") ?? "";
      const resp = await fetch(`https://api.bland.ai/v1/sms/conversations/${conversationId}`, {
        headers: { authorization: apiKey },
      });
      const json = await resp.json();
      const messages: { sender: string; message: string }[] = json.data?.messages ?? [];
      const first = messages.find((m) => m.sender === "AGENT");
      if (first) {
        await this.state.storeMessage(phone, conversationId, "AI Bot", first.message);
        console.log(`[Trigger] 📩 Stored initial Bland message for ${phone} (convo: ${conversationId})`);
      } else {
        console.warn(`[Trigger] ⚠️ No AGENT message found yet for convo ${conversationId}`);
      }
    } catch (e: any) {
      console.warn(`[Trigger] ⚠️ Failed to store initial Bland message: ${e.message}`);
    }
  }

  // --- INJECTION LOGIC (API Calls only - RateLimiter uses in-memory queue) ---
  async injectLead(
    lead: ReadymodeLeadDto,
    domain: DialerDomain,
    campaignId?: string,
    overrideChannel?: string,
  ): Promise<ReadymodeResponseDto> {
    if (lead.reservationId && !lead.firstName) {
      try {
        console.log(`[Inject] 🔍 Fresh CRM Lookup for ResID: ${lead.reservationId}`);
        const guest = await this.crm.findGuestByResId(Number(lead.reservationId));
        if (guest) {
          lead.firstName = guest.GuestFullName || lead.firstName;
          lead.lastName = guest.SpouseName || guest.SpouseFullName || "";
        }
      } catch (e) {
        console.warn(`[Inject] ⚠️ Failed to refresh CRM data: ${e}`);
      }
    }

    const config = DOMAIN_CONFIG[domain];
    const targetId = campaignId || overrideChannel || config.channels.addLead;
    const baseUrl = `${config.baseUrl}/lead-api/${targetId}`;

    console.log(`[Inject] 🚀 Starting Injection for ${lead.phone} to ${domain}`);
    console.log(`[Inject] 🎯 Target Campaign ID: ${targetId}`);

    // Preemptive scrub to prevent duplicates from previous test injections
    console.log(`[Inject] 🧹 Preemptive scrub before injection...`);
    try {
      await this.scrubLead(lead.phone, domain);
    } catch (e) {
      console.warn(`[Inject] ⚠️ Preemptive scrub failed (non-fatal): ${e}`);
    }

    const finalUrl = this.buildUrl(baseUrl, lead);
    const requestOptions = { method: "POST" };

    console.log(`[Inject] 🔗 URL: ${finalUrl}`);

    try {
      const res = await fetch(finalUrl, requestOptions);

      const text = await res.text();
      console.log(`[Inject] 📡 HTTP Status: ${res.status} ${res.statusText}`);
      console.log(`[Inject] 📡 Response Body: '${text}'`);

      let success = false;
      let jsonRes: any = null;

      try {
        jsonRes = JSON.parse(text);
      } catch (e) { /* ignore */ }

      if (
        (jsonRes && jsonRes.Success === true) ||
        (jsonRes && jsonRes["0"] && jsonRes["0"].Success === true) ||
        text.includes('"Success":true') ||
        text.includes('"Success": true')
      ) {
        console.log(`[Inject] ✅ Success Detected.`);
        success = true;
      } else if (
        text.includes("Duplicate") || text.includes("leadId") || (jsonRes && jsonRes.xencall_leadId)
      ) {
        console.warn(
          `[Inject] ⚠️ Duplicate/Existing Lead Detected. Initiating Scrub & Timestamp Hack...`,
        );

        const retry = await this.handleDuplicate(lead, domain, text, finalUrl, requestOptions);
        success = retry.status === "success";
        console.log(`[Inject] 🔄 Retry Sequence Result: ${success ? "SUCCESS" : "FAILED"}`);
      } else {
        console.warn(`[Inject] ❓ Ambiguous Response. Assuming success if 200 OK.`);
        success = res.ok;
      }

      if (success) {
        await this.orchestrator.logEvent(lead.phone, {
          action: "INJECT",
          domain: domain,
          campaignId: campaignId || "API",
          details: `Injected to ${domain}`,
        });

        await this.orchestrator.updatePointer(lead.phone, {
          currentLocation: {
            domain,
            campaignId: campaignId || "API",
            timestamp: Date.now(),
          },
          status: domain === DialerDomain.ODR ? "IN_ODR" : "ACTIVE",
        });

        return { status: "success", message: "Injected" };
      }

      console.error(`[Inject] ❌ Injection Failed. Code: ${res.status}`);
      return { status: "error", message: `Injection Failed: ${text}` };
    } catch (e: any) {
      console.error(`[Inject] 💥 Fatal Error: ${e.message}`);
      throw new Error(`Injection Failed: ${e.message}`);
    }
  }

  private buildUrl(baseUrl: string, lead: any): string {
    const params = new URLSearchParams();
    const p = (field: string, value: string | undefined | number) => {
      if (value !== undefined && value !== null && value !== "") {
        params.append(`lead[0][${field}]`, String(value));
      }
    };

    p("phone", lead.phone || lead.primaryPhone);

    Object.keys(lead).forEach((key) => {
      if (key !== "phone" && key !== "primaryPhone") {
        p(key, lead[key]);
      }
    });

    if (!lead.Custom_21 && !lead.notes) {
      p(
        "Custom_21",
        `Scheduled Call Added at: ${
          new Date().toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "numeric",
            day: "numeric",
            year: "2-digit",
            hour: "numeric",
            minute: "2-digit",
          }).replace(",", "")
        }`,
      );
    }

    return `${baseUrl}/?${params.toString()}`;
  }

  async scrubLead(phone: string, domain: DialerDomain, leadId?: string): Promise<boolean> {
    const config = DOMAIN_CONFIG[domain];
    const url = `${config.baseUrl}/${config.channels.scrubLead}`;

    const user = Deno.env.get("RM_USER") || Deno.env.get(`RM_${domain}_USER`) || "adam";
    const pass = Deno.env.get("RM_PASS") || Deno.env.get(`RM_${domain}_PASS`) || "Winter123";

    const params = new URLSearchParams();
    params.append("API_user", user);
    params.append("API_pass", pass);
    if (phone) params.append("lead[phone]", phone.replace(/\D/g, "").slice(-10));
    if (leadId) params.append("lead[leadId]", leadId);
    params.append("result", "false");

    console.log(`[Scrub] 🧹 Scrubbing lead ${phone} (ID: ${leadId}) on ${domain}...`);

    try {
      const res = await this.limiter.schedule(() =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
      );

      const text = await res.text();
      const success = text.includes("Success") || res.ok;
      console.log(`[Scrub] 📥 Result: ${success ? "SUCCESS" : "FAILED"} (Text: ${text})`);

      if (success) {
        await this.orchestrator.logEvent(phone, {
          action: "SCRUB",
          domain: domain,
          details: "Scrubbed from campaign",
        });
      }

      return success;
    } catch (e: any) {
      console.error(`[Scrub] 💥 Failed: ${e.message}`);
      return false;
    }
  }

  async dncGlobal(phone: string): Promise<Record<string, string>> {
    if (phone === "0") return {};
    const results: Record<string, string> = {};
    for (const domain of Object.values(DialerDomain)) {
      try {
        const success = await this.dncLead(phone, domain);
        results[domain] = success ? "Success" : "Failed";
      } catch (e) {
        results[domain] = "Error";
      }
    }
    return results;
  }

  private async dncLead(
    phone: string,
    domain: DialerDomain,
    reason = "API Request",
  ): Promise<boolean> {
    const config = DOMAIN_CONFIG[domain];
    const url = `${config.baseUrl}/${config.channels.dnc}`;

    const user = Deno.env.get("RM_USER") || Deno.env.get(`RM_${domain}_USER`) || "adam";
    const pass = Deno.env.get("RM_PASS") || Deno.env.get(`RM_${domain}_PASS`) || "Winter123";

    const params = new URLSearchParams();
    params.append("API_user", user);
    params.append("API_pass", pass);
    params.append("entry[phone]", phone);
    params.append("entry[reason] ", reason);

    try {
      const res = await this.limiter.schedule(() =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
      );
      return (await res.text()).includes("Success") || res.ok;
    } catch (e: any) {
      return false;
    }
  }

  private async handleDuplicate(
    lead: ReadymodeLeadDto,
    domain: DialerDomain,
    errorBody: string,
    originalUrl: string,
    requestOptions: any,
  ): Promise<ReadymodeResponseDto> {
    let leadId: string | undefined;

    const textMatch = errorBody.match(/Lead ID XC:([\d]+)/);
    if (textMatch && textMatch[1]) leadId = textMatch[1];

    if (!leadId) {
      const jsonMatch = errorBody.match(/"xencall_leadId":\s*"XC:([\d]+)"/);
      if (jsonMatch && jsonMatch[1]) leadId = jsonMatch[1];
    }

    if (!leadId) return { status: "error", message: "Duplicate - ID Parse Failed" };

    const scrubbed = await this.scrubLead(lead.phone, domain, leadId);
    if (!scrubbed) return { status: "error", message: "Scrub Failed" };

    const timestamp = Date.now().toString();
    const newUrl = originalUrl.replace(/lead%5B0%5D/g, `lead%5B${timestamp}%5D`)
      .replace(/lead\[0\]/g, `lead[${timestamp}]`);

    console.log(`[Inject] 🔄 Retrying with Timestamp ID: ${timestamp} ...`);
    console.log(`[Inject] 🔄 New URL: ${newUrl}`);

    const retryRes = await this.limiter.schedule(() => fetch(newUrl, requestOptions));
    const retryText = await retryRes.text();
    console.log(`[Inject] 🔄 Retry Response: ${retryText}`);

    if (
      retryText.includes("Success") ||
      retryText.includes("success") ||
      retryText.includes('"Success": true')
    ) {
      return { status: "success", message: "Injected after Scrub" };
    }
    return { status: "error", message: "Retry Failed" };
  }
}
