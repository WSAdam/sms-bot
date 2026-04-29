import { Module } from "#nestjs/common";
import { LeadOrchestratorController } from "@leadorchestrator/controller/mod.ts";
import { LeadOrchestratorService } from "@leadorchestrator/service/mod.ts";

@Module({
  controllers: [LeadOrchestratorController],
  providers: [LeadOrchestratorService],
  exports: [LeadOrchestratorService],
})
export class LeadOrchestratorModule {}

// Re-export everything so external files (Queue, Readymode) can import from here
export * from "./controller/mod.ts";
export * from "./service/mod.ts";
