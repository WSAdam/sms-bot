import { Injectable, Logger } from "#nestjs/common";
import { Buffer } from "node:buffer";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

export interface SmsFlowContext {
  domain: string;
  campaignId: string;
  reservationId?: string;
  phone: string;
  leadId?: string;
  destination?: string;
  firstName?: string;
  lastName?: string;
  timestamp: number;
  [key: string]: any;
}

export interface ConversationMessage {
  phoneNumber: string;
  callId: string;
  timestamp: string;
  sender: "Guest" | "AI Bot";
  message: string;
  nodeTag?: string;
  doNotText?: boolean;
}

export interface FutureInjection {
  phone: string;
  eventTime: string;
  scheduledAt: number;
  isTest?: boolean;
  calendlyInviteeUri?: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class SmsFlowStateService {
  private readonly logger = new Logger(SmsFlowStateService.name);
  private readonly kvServiceUrl: string;

  constructor() {
    this.kvServiceUrl = Deno.env.get("KV_SERVICE_URL") ||
      "https://google-sheets-kv.thetechgoose.deno.net";
    this.logger.log(`[SmsFlowState] 🌐 Using Remote KV (HTTPS) at: ${this.kvServiceUrl}`);
  }

  // ===========================================================================
  // 🛡️ NODE.JS HTTPS REQUEST (Robust HTTP Client)
  // ===========================================================================

  public async request<T>(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    params?: Record<string, any>,
    body?: any,
  ): Promise<T | null> {
    const fullUrl = new URL(`${this.kvServiceUrl}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        fullUrl.searchParams.append(k, val);
      });
    }

    const bodyData = body ? JSON.stringify(body) : undefined;
    const isHttps = fullUrl.protocol === "https:";
    const client = isHttps ? https : http;

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const result = await new Promise<T | null>((resolve, reject) => {
          const options: https.RequestOptions = {
            method: method,
            headers: {
              "Accept": "application/json",
              "Content-Type": "application/json",
              "Connection": "close",
            },
            agent: false,
            timeout: 10000,
          };

          if (bodyData) {
            (options.headers as any)["Content-Length"] = Buffer.byteLength(bodyData);
          }

          const req = client.request(fullUrl, options, (res) => {
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => {
              if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                if (res.statusCode === 404) {
                  resolve(null);
                  return;
                }
                reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                return;
              }
              if (!data || data.trim() === "") {
                resolve(null);
                return;
              }
              try {
                resolve(JSON.parse(data));
              } catch (e: any) {
                reject(new Error(`JSON Parse Error: ${e.message}`));
              }
            });
          });

          req.on("error", (e) => reject(e));
          if (bodyData) req.write(bodyData);
          req.end();
        });
        return result;
      } catch (error: any) {
        this.logger.error(`[KV-Client] 💥 Request Failed (Attempt ${attempt}): ${error.message}`);
        if (attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt - 1);
          await wait(delay);
        } else {
          throw error;
        }
      }
    }
    return null;
  }

  // ===========================================================================
  // 🔓 PRIMITIVE KV METHODS
  // ===========================================================================

  async get<T>(key: Deno.KvKey): Promise<T | null> {
    const data = await this.request<{ value: T }>("GET", "/api/kv/get", { key });
    return data?.value ?? null;
  }

  async set<T>(key: Deno.KvKey, value: T, expireIn?: number): Promise<void> {
    await this.request("POST", "/api/kv/set", undefined, { key, value, expireIn });
  }

  async delete(key: Deno.KvKey): Promise<void> {
    await this.request("DELETE", "/api/kv/delete", { key });
  }

  async list<T>(prefix: Deno.KvKey, limit?: number): Promise<Array<{ key: Deno.KvKey; value: T }>> {
    const data = await this.request<{ entries: Array<{ key: Deno.KvKey; value: T }> }>(
      "POST",
      "/api/kv/list",
      undefined,
      { prefix, limit },
    );
    return data?.entries ?? [];
  }

  // ===========================================================================
  // 📦 DOMAIN HELPER METHODS
  // ===========================================================================

  private normalize(phone: string): string {
    if (!phone) return "";
    return decodeURIComponent(phone).replace(/\D/g, "").slice(-10);
  }

  async saveContext(phone: string, context: Partial<SmsFlowContext>) {
    const cleanPhone = this.normalize(phone);
    const key = ["sms_flow_context", cleanPhone];
    let existing = {};
    try {
      existing = (await this.getContext(cleanPhone)) || {};
    } catch (e) { /* ignore */ }
    await this.set(key, { ...existing, ...context, phone: cleanPhone, timestamp: Date.now() });
    this.logger.log(`[SmsFlowState] Saved context for ${cleanPhone}`);
  }

  async getContext(phone: string): Promise<SmsFlowContext | null> {
    const cleanPhone = this.normalize(phone);
    return await this.get<SmsFlowContext>(["sms_flow_context", cleanPhone]);
  }

  async scheduleInjection(phone: string, eventTime: string | Date, isTest = false) {
    const cleanPhone = this.normalize(phone);
    const isoTime = typeof eventTime === "string" ? eventTime : eventTime.toISOString();
    await this.request("POST", "/api/injection/schedule", undefined, {
      phone: cleanPhone,
      eventTime: isoTime,
      isTest,
    });
    this.logger.log(`[SmsFlowState] Scheduled injection for ${cleanPhone} at ${isoTime}`);
  }

  async deleteFutureInjection(phone: string) {
    const cleanPhone = this.normalize(phone);
    await this.request("DELETE", "/api/injection/cancel", { phone: cleanPhone });
  }

  async storeMessage(
    phoneNumber: string,
    callId: string,
    sender: "Guest" | "AI Bot",
    message: string,
    nodeTag?: string,
    doNotText?: boolean,
  ) {
    const cleanPhone = this.normalize(phoneNumber);
    const cleanCallId = decodeURIComponent(callId);
    const timestamp = new Date().toISOString();

    const msg: ConversationMessage = {
      phoneNumber: cleanPhone,
      callId: cleanCallId,
      timestamp,
      sender,
      message,
      ...(nodeTag && { nodeTag }),
      ...(doNotText && { doNotText: true }),
    };

    const key = ["conversations", cleanPhone, cleanCallId, timestamp];
    await this.set(key, msg);

    // 🔥 SAVE SECONDARY INDEX for getConversationByCallId
    // Allows us to find the phone number using just the callId later
    await this.set(["lookup_call_id", cleanCallId], { phone: cleanPhone });

    return msg;
  }

  async checkIfOptedOut(phoneNumber: string): Promise<boolean> {
    const cleanPhone = this.normalize(phoneNumber);
    const entries = await this.list<ConversationMessage>(["conversations", cleanPhone]);
    return entries.some((e) => e.value.doNotText === true);
  }

  async getHistoryContext(phoneNumber: string) {
    const cleanPhone = this.normalize(phoneNumber);
    const entries = await this.list<ConversationMessage>(["conversations", cleanPhone]);
    const messages = entries.map((e) => e.value);

    if (messages.length === 0) return { contextString: "No previous conversations.", count: 0 };

    const contextString = messages.map((msg) => {
      const date = new Date(msg.timestamp).toLocaleString();
      const tag = msg.nodeTag ? `[${msg.nodeTag}]` : "";
      return `[${date}] ${tag} ${msg.sender}: ${msg.message}`;
    }).join("\n");

    return { contextString, count: messages.length };
  }

  async deleteConversations(phoneNumber: string) {
    const cleanPhone = this.normalize(phoneNumber);
    const entries = await this.list(["conversations", cleanPhone]);
    for (const entry of entries) await this.delete(entry.key);
    return entries.length;
  }

  // ===========================================================================
  // 🔥 NEW METHODS FOR CALENDLY SUPPORT
  // ===========================================================================

  /**
   * Retrieves all conversation messages for a specific phone number.
   */
  async getAllConversations(phoneNumber: string): Promise<ConversationMessage[]> {
    const cleanPhone = this.normalize(phoneNumber);
    const entries = await this.list<ConversationMessage>(["conversations", cleanPhone]);
    return entries.map((e) => e.value).sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Retrieves a single conversation/call record by its Call ID.
   * Uses the secondary index ["lookup_call_id", callId] to find the phone number first.
   */
  async getConversationByCallId(callId: string): Promise<ConversationMessage | null> {
    const cleanCallId = decodeURIComponent(callId);

    // 1. Try to find the phone number associated with this Call ID
    const lookup = await this.get<{ phone: string }>(["lookup_call_id", cleanCallId]);

    if (!lookup || !lookup.phone) {
      this.logger.warn(`[SmsFlowState] ⚠️ Could not find phone number for Call ID: ${cleanCallId}`);
      return null;
    }

    // 2. Now list conversations for that phone + callId prefix
    const entries = await this.list<ConversationMessage>([
      "conversations",
      lookup.phone,
      cleanCallId,
    ]);

    // Return the first match (there should typically be one main record or a few messages)
    // If you need specific message, logic might differ, but usually we just want the context
    return entries.length > 0 ? entries[0].value : null;
  }

  /**
   * 🧹 Comprehensive cleanup: Deletes ALL KV entries for a phone number.
   * This resets the guest to a completely fresh state for testing purposes.
   *
   * Cleans up:
   * - SMS flow context
   * - Conversation history
   * - Lead pointer state
   * - Lead event history
   * - Rate limiting records
   * - Injection locks (all domains)
   * - Scheduled future injections
   */
  async deleteAllForPhone(phone: string): Promise<{
    deleted: number;
    categories: Record<string, number>;
  }> {
    const cleanPhone = this.normalize(phone);
    let totalDeleted = 0;
    const categories: Record<string, number> = {};

    this.logger.log(`[SmsFlowState] 🧹 Starting comprehensive cleanup for ${cleanPhone}...`);

    // 1. SMS Flow Context
    try {
      await this.delete(["sms_flow_context", cleanPhone]);
      categories["sms_flow_context"] = 1;
      totalDeleted++;
      this.logger.log(`[SmsFlowState] ✅ Deleted SMS flow context`);
    } catch (_e) {
      this.logger.warn(`[SmsFlowState] ⚠️ No SMS flow context to delete`);
      categories["sms_flow_context"] = 0;
    }

    // 2. Conversations
    try {
      const conversationCount = await this.deleteConversations(cleanPhone);
      categories["conversations"] = conversationCount;
      totalDeleted += conversationCount;
      this.logger.log(`[SmsFlowState] ✅ Deleted ${conversationCount} conversation entries`);
    } catch (_e) {
      this.logger.warn(`[SmsFlowState] ⚠️ Error deleting conversations: ${_e}`);
      categories["conversations"] = 0;
    }

    // 3. Lead Pointer
    try {
      await this.delete(["lead_pointer", cleanPhone]);
      categories["lead_pointer"] = 1;
      totalDeleted++;
      this.logger.log(`[SmsFlowState] ✅ Deleted lead pointer`);
    } catch (_e) {
      this.logger.warn(`[SmsFlowState] ⚠️ No lead pointer to delete`);
      categories["lead_pointer"] = 0;
    }

    // 4. Lead History
    try {
      const historyEntries = await this.list(["lead_history", cleanPhone]);
      for (const entry of historyEntries) {
        await this.delete(entry.key);
      }
      categories["lead_history"] = historyEntries.length;
      totalDeleted += historyEntries.length;
      this.logger.log(`[SmsFlowState] ✅ Deleted ${historyEntries.length} lead history entries`);
    } catch (_e) {
      this.logger.warn(`[SmsFlowState] ⚠️ Error deleting lead history: ${_e}`);
      categories["lead_history"] = 0;
    }

    // 5. Rate Limit
    try {
      await this.delete(["rate_limit", "30d", cleanPhone]);
      categories["rate_limit"] = 1;
      totalDeleted++;
      this.logger.log(`[SmsFlowState] ✅ Deleted rate limit record`);
    } catch (_e) {
      this.logger.warn(`[SmsFlowState] ⚠️ No rate limit record to delete`);
      categories["rate_limit"] = 0;
    }

    // 6. Injection Locks (check all known domains)
    const domains = ["monsteract", "monsterods", "monsterodr", "monsterrd2", "monsterrg"];
    let lockCount = 0;
    for (const domain of domains) {
      try {
        await this.delete(["injection_lock", cleanPhone, domain]);
        lockCount++;
      } catch (_e) {
        // Silent - locks may not exist for all domains
      }
    }
    categories["injection_locks"] = lockCount;
    totalDeleted += lockCount;
    if (lockCount > 0) {
      this.logger.log(`[SmsFlowState] ✅ Deleted ${lockCount} injection locks`);
    }

    // 7. Future Scheduled Injection (via remote API)
    try {
      await this.deleteFutureInjection(cleanPhone);
      categories["scheduled_injection"] = 1;
      totalDeleted++;
      this.logger.log(`[SmsFlowState] ✅ Deleted scheduled future injection`);
    } catch (e) {
      this.logger.warn(`[SmsFlowState] ⚠️ No scheduled injection to delete`);
      categories["scheduled_injection"] = 0;
    }

    this.logger.log(
      `[SmsFlowState] 🎉 Cleanup complete for ${cleanPhone}. Total deleted: ${totalDeleted}`,
    );

    return { deleted: totalDeleted, categories };
  }
}
