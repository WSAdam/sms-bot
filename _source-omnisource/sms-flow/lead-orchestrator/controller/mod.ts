import { Controller, Get, Logger, NotFoundException, Param } from "#nestjs/common";
import { ApiOperation, ApiTags } from "#nestjs/swagger";
import { LeadOrchestratorService } from "@leadorchestrator/service/mod.ts";

@ApiTags("Lead Orchestrator")
@Controller("sms-flow/orchestrator")
export class LeadOrchestratorController {
  private readonly logger = new Logger(LeadOrchestratorController.name);

  constructor(private readonly orchestrator: LeadOrchestratorService) {
    this.logger.log(`[OrchestratorController] 🏗️ Controller initialized`);
  }

  @Get("pointer/:phone")
  @ApiOperation({ summary: "Get the current location pointer for a lead" })
  async getPointer(@Param("phone") phone: string) {
    console.log(`=======================================================`);
    console.log(`[GetPointer] 🔍 GET POINTER REQUEST`);
    console.log(`[GetPointer] 🔍 Timestamp: ${new Date().toISOString()}`);
    console.log(`[GetPointer] 🔍 Phone (from URL): ${phone}`);
    console.log(`=======================================================`);

    console.log(`[GetPointer] 📞 Calling orchestrator.getPointer(${phone})...`);
    const pointer = await this.orchestrator.getPointer(phone);

    console.log(`[GetPointer] 📊 Result:`);
    console.log(`[GetPointer] 📊 ${JSON.stringify(pointer, null, 2)}`);

    if (!pointer) {
      console.error(`[GetPointer] ❌ No pointer found for ${phone}`);
      throw new NotFoundException(`No pointer found for ${phone}`);
    }

    console.log(`[GetPointer] ✅ Pointer found - returning to client`);
    console.log(`=======================================================`);
    return pointer;
  }

  @Get("events/:phone")
  @ApiOperation({ summary: "Get the audit trail for a lead" })
  async getEvents(@Param("phone") phone: string) {
    console.log(`=======================================================`);
    console.log(`[GetEvents] 📜 GET EVENTS REQUEST`);
    console.log(`[GetEvents] 📜 Timestamp: ${new Date().toISOString()}`);
    console.log(`[GetEvents] 📜 Phone (from URL): ${phone}`);
    console.log(`=======================================================`);

    console.log(`[GetEvents] 📞 Calling orchestrator.getEvents(${phone})...`);
    const events = await this.orchestrator.getEvents(phone);

    console.log(`[GetEvents] 📊 Found ${events.length} events`);
    console.log(`[GetEvents] 📊 Events: ${JSON.stringify(events, null, 2)}`);
    console.log(`[GetEvents] ✅ Returning events to client`);
    console.log(`=======================================================`);

    return events;
  }
}
