import { Injectable, Logger } from "#nestjs/common";
import { SmsFlowStateService } from "@sms-flow/kv/mod.ts";

@Injectable()
export class AbTestService {
  private readonly logger = new Logger(AbTestService.name);

  constructor(private readonly state: SmsFlowStateService) {
    this.logger.log(`[AbTest] 🌐 Using SmsFlowStateService (Remote KV)`);
  }

  /**
   * Toggles between A and B logic using Remote KV.
   * Returns "A" or "B".
   */
  async getVariant(): Promise<"A" | "B"> {
    const key = ["sms_ab_toggle"];

    try {
      // 0 = A, 1 = B. Flip it every time.
      const currentVal = await this.state.get<number>(key);
      const current = currentVal ?? 0;
      const next = current === 0 ? 1 : 0;

      await this.state.set(key, next);

      const variant = current === 0 ? "A" : "B";
      this.logger.debug(`[A/B] Selected Variant (Remote): ${variant}`);
      return variant;
    } catch (e: any) {
      this.logger.error(`[A/B] Error toggling variant: ${e.message}`);
      return "A"; // Default to A on error
    }
  }
}
