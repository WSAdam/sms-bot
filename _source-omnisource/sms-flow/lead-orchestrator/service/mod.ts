import { Injectable, Logger } from "#nestjs/common";
import { SmsFlowStateService } from "@sms-flow/kv/mod.ts";
import { DialerDomain } from "@sms-flow/readymode/dto/mod.ts";

export interface LeadLocation {
  domain: DialerDomain;
  campaignId: string;
  timestamp: number;
}

export interface LeadPointer {
  phone: string;
  currentLocation: LeadLocation | null;
  originalSource: LeadLocation | null;
  status: "ACTIVE" | "SCRUBBED" | "SCHEDULED_FOR_ODR" | "IN_ODR" | "RETURNED_TO_SOURCE";
  lastAction: string;
}

export interface OrchestratorEvent {
  action: "INJECT" | "SCRUB" | "DNC" | "APPT_SCHEDULED" | "INIT" | "SCHEDULE_TIMER";
  domain: DialerDomain;
  campaignId?: string;
  details?: string;
  timestamp: number;
}

@Injectable()
export class LeadOrchestratorService {
  private readonly logger = new Logger(LeadOrchestratorService.name);

  constructor(private readonly state: SmsFlowStateService) {
    this.logger.log(`[Orchestrator] 🌐 Using SmsFlowStateService (Remote)`);
  }

  private normalize(phone: string): string {
    if (!phone) return "";
    return decodeURIComponent(phone).replace(/\D/g, "").slice(-10);
  }

  // ===========================================================================
  // 🎮 POINTER & EVENT LOGIC
  // ===========================================================================

  async updatePointer(phone: string, update: Partial<LeadPointer>) {
    const cleanPhone = this.normalize(phone);
    const key = ["lead_pointer", cleanPhone];

    console.log(`[Orchestrator] 📝 Updating pointer for ${cleanPhone} (Raw: ${phone})`);

    const existing = (await this.state.get<LeadPointer>(key)) || {
      phone: cleanPhone,
      currentLocation: null,
      originalSource: null,
      status: "SCRUBBED",
      lastAction: "INIT",
    };

    const nextState: LeadPointer = { ...existing, ...update, phone: cleanPhone };

    console.log(`[Orchestrator] 📊 Previous state: ${JSON.stringify(existing)}`);
    console.log(`[Orchestrator] 🔄 New state: ${JSON.stringify(nextState)}`);

    await this.state.set(key, nextState);

    console.log(`[Orchestrator] ✅ Pointer Updated for ${cleanPhone}: ${nextState.status}`);
    return nextState;
  }

  async logEvent(phone: string, event: Omit<OrchestratorEvent, "timestamp">) {
    const cleanPhone = this.normalize(phone);
    const entry: OrchestratorEvent = {
      ...event,
      timestamp: Date.now(),
    };

    const eventKey = ["lead_history", cleanPhone, entry.timestamp];

    console.log(
      `[Orchestrator] 📝 Logging event for ${cleanPhone} (Raw: ${phone}): ${event.action}`,
    );

    try {
      await this.state.set(eventKey, entry, 1000 * 60 * 60 * 24 * 90); // 90 days expiry
      console.log(
        `[Orchestrator] ✅ Event logged: ${cleanPhone} | ${event.action} | ${
          event.details || "N/A"
        }`,
      );
    } catch (e: any) {
      this.logger.error(`[Orchestrator] ❌ Failed to log event: ${e.message}`);
    }
  }

  async getPointer(phone: string): Promise<LeadPointer | null> {
    const cleanPhone = this.normalize(phone);
    console.log(`[Orchestrator] 🔍 Fetching pointer for ${cleanPhone} (Raw: ${phone})`);
    const pointer = await this.state.get<LeadPointer>(["lead_pointer", cleanPhone]);

    if (pointer) {
      console.log(`[Orchestrator] ✅ Found pointer: ${JSON.stringify(pointer)}`);
    } else {
      console.log(`[Orchestrator] ❌ No pointer found for ${cleanPhone}`);
    }

    return pointer;
  }

  async *getAllPointers() {
    const entries = await this.state.list<LeadPointer>(["lead_pointer"]);
    for (const entry of entries) {
      yield entry.value;
    }
  }

  async getEvents(phone: string): Promise<OrchestratorEvent[]> {
    const cleanPhone = this.normalize(phone);
    console.log(`[Orchestrator] 🔍 Fetching events for ${cleanPhone} (Raw: ${phone})`);
    const entries = await this.state.list<OrchestratorEvent>(["lead_history", cleanPhone]);

    const results = entries.map((e) => e.value);

    console.log(`[Orchestrator] 📊 Found ${results.length} events for ${cleanPhone}`);

    return results;
  }
}
