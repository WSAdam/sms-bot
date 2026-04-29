import { Body, Controller, Injectable, Logger, Post } from "#nestjs/common";
import { ApiOperation, ApiTags } from "#nestjs/swagger";
import { LeadOrchestratorService } from "@leadorchestrator/mod.ts";
import { CAMPAIGN_MASTER_MAP } from "@sms-flow/readymode/campaigns/mod.ts";
import { ReadymodeService } from "@sms-flow/readymode/service/mod.ts";

export interface QueueMessage {
  type: "INJECT_APPT";
  phone: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly readymode: ReadymodeService,
    private readonly orchestrator: LeadOrchestratorService,
  ) {}

  // NOTE: Logic moved here from previous listener
  async handleDelayedInjection(phone: string) {
    this.logger.log(`[Queue] ⏰ Time Reached! Processing ODR Injection for ${phone}`);

    const pointer = await this.orchestrator.getPointer(phone);
    if (pointer?.originalSource) {
      this.logger.log(`[Queue] Scrubbing original source: ${pointer.originalSource.domain}`);
      try {
        await this.readymode.scrubLead(phone, pointer.originalSource.domain);
      } catch (e: any) {
        this.logger.warn(`[Queue] Scrub failed (non-fatal): ${e.message}`);
      }
    }

    const target = CAMPAIGN_MASTER_MAP["ODR - Appointments"];
    if (!target) {
      this.logger.error("[Queue] CRITICAL: 'ODR - Appointments' campaign config is missing!");
      return;
    }

    const result = await this.readymode.injectLead(
      {
        phone: phone,
        notes: "Scheduled Appointment Time Reached - Auto Injection",
      } as any, // Cast to avoid strict type issues with 'notes' vs 'note'
      target.domain,
      target.id,
    );

    if (result.status === "success") {
      this.logger.log(`[Queue] Successfully injected ${phone} into ODR.`);

      await this.orchestrator.logEvent(phone, {
        action: "INJECT",
        domain: target.domain,
        details: "Queue Worker: Scheduled Appointment Injection",
      });

      await this.orchestrator.updatePointer(phone, {
        status: "IN_ODR",
        currentLocation: {
          domain: target.domain,
          campaignId: target.id,
          timestamp: Date.now(),
        },
      });
    } else {
      this.logger.error(`[Queue] Failed to inject ${phone} into ODR.`);
    }
  }
}

@ApiTags("SMS Flow Queue")
@Controller("sms-flow/queue")
export class QueueController {
  private readonly logger = new Logger(QueueController.name);

  constructor(private readonly queueService: QueueService) {}

  @Post("trigger")
  @ApiOperation({
    summary: "Trigger scheduled appointment injection",
    description:
      "Called by external KV cron service when scheduled appointment time is reached. Triggers ODR injection workflow.",
  })
  async triggerInjection(@Body() body: QueueMessage) {
    this.logger.log(`[QueueController] 🎯 Received trigger request for ${body.phone}`);

    if (body.type === "INJECT_APPT" && body.phone) {
      // Async handling so we don't timeout the caller
      this.queueService.handleDelayedInjection(body.phone).catch((err) =>
        this.logger.error(`[QueueController] Async Handler Error: ${err.message}`)
      );
      return { success: true, phone: body.phone, message: "Processing started" };
    }

    this.logger.error(`[QueueController] ❌ Invalid message format: ${JSON.stringify(body)}`);
    return { success: false, error: "Invalid message format" };
  }
}
