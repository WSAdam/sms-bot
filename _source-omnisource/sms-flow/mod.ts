import { Module } from "#nestjs/common";
import { BlandSmsService } from "@calendly/bland-sms/mod.ts";
import { ReservationFinderService } from "@calendly/reservation-finder/mod.ts";
import { LeadOrchestratorController } from "@leadorchestrator/controller/mod.ts";
import { LeadOrchestratorService } from "@leadorchestrator/mod.ts";
import { AbTestService } from "@sms-flow/ab-test/mod.ts";
import { SmsCallbackController } from "@sms-flow/callback/mod.ts";
import { CrmService } from "@sms-flow/crm/mod.ts";
import { SmsFlowStateService } from "@sms-flow/kv/mod.ts";
import { QueueService } from "@sms-flow/queue/mod.ts";
import { RateLimiterService } from "@sms-flow/rate-limiter/mod.ts";
import { ReadymodeMappingService } from "@sms-flow/readymode/mapping/mod.ts";
import { ReadymodeService } from "@sms-flow/readymode/service/mod.ts";
import { SmsTriggerController } from "@sms-flow/trigger/mod.ts";

@Module({
  imports: [],
  controllers: [
    SmsCallbackController,
    SmsTriggerController,
    LeadOrchestratorController,
  ],
  providers: [
    ReadymodeService,
    ReadymodeMappingService,
    RateLimiterService,
    AbTestService,
    SmsFlowStateService,
    CrmService,
    BlandSmsService,
    LeadOrchestratorService,
    QueueService,
    ReservationFinderService,
  ],
  exports: [
    ReadymodeService,
    ReadymodeMappingService,
    RateLimiterService,
    AbTestService,
    SmsFlowStateService,
    CrmService,
    BlandSmsService,
    LeadOrchestratorService,
    QueueService,
    ReservationFinderService,
  ],
})
export class SmsFlowModule {}
