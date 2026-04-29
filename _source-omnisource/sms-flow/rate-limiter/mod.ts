import { Injectable, Logger } from "#nestjs/common";
import { SmsFlowStateService } from "@sms-flow/kv/mod.ts";

interface RateLimitRecord {
  limited: boolean;
  at: number; // Timestamp
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  // Memory-only queue to prevent request flooding
  private queue: Promise<any> = Promise.resolve();

  constructor(private readonly state: SmsFlowStateService) {}

  // --- 1. CHECK LOGIC ---\
  async checkOnly(phone: string): Promise<boolean> {
    try {
      const key = ["rate_limit", "30d", phone];
      const record = await this.state.get<RateLimitRecord>(key);

      // If record exists, check if it's within the last 30 days
      if (record && record.at) {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const diff = Date.now() - record.at;

        if (diff < thirtyDaysMs) {
          const daysRemaining = Math.ceil((thirtyDaysMs - diff) / (24 * 60 * 60 * 1000));
          this.logger.warn(`[RateLimit] 🛑 ${phone} is blocked. (${daysRemaining} days remaining)`);
          return false; // BLOCKED
        }
      }

      // If no record, or record is older than 30 days
      return true; // ALLOWED
    } catch (e) {
      this.logger.error(`[RateLimit] Failed to check status: ${e}`);
      return true; // Fail open if Remote DB is unreachable
    }
  }

  // --- 2. RESERVE LOGIC ---\
  async reserve(phone: string): Promise<void> {
    try {
      const key = ["rate_limit", "30d", phone];
      // Store current timestamp so we can calculate the 30 days later
      await this.state.set(key, { limited: true, at: Date.now() });
      this.logger.log(`[RateLimit] 🔒 Reserved/Locked ${phone} for 30 days via Remote KV`);
    } catch (e) {
      this.logger.error(`[RateLimit] Failed to reserve: ${e}`);
    }
  }

  // --- UTILS ---\
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => fn());
    this.queue = result.catch(() => {});
    return result;
  }
}
