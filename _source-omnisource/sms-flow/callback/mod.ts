import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
} from "#nestjs/common";
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "#nestjs/swagger";
import { ReservationFinderService } from "@calendly/reservation-finder/mod.ts";
import { PhoneNumber } from "@libs/string-manipulation";
import { SmsFlowStateService } from "@sms-flow/kv/mod.ts";
import { LeadOrchestratorService } from "@sms-flow/lead-orchestrator/service/mod.ts";
import { CAMPAIGN_MASTER_MAP, getCampaignConfig } from "@sms-flow/readymode/campaigns/mod.ts";
import {
  AppointmentDto,
  DialerDomain,
  DispositionDto,
  PhoneDto,
  ReadymodeLeadDto,
  ReadymodeResponseDto,
} from "@sms-flow/readymode/dto/mod.ts";
import { ReadymodeMappingService, StandardLead } from "@sms-flow/readymode/mapping/mod.ts";
import { ReadymodeService } from "@sms-flow/readymode/service/mod.ts";

function nowMs(): number {
  return Date.now();
}

function newRid(): string {
  // crypto.randomUUID exists on Node 19+/Deno; on older Node this may not exist.
  // If your runtime doesn’t support it, swap to a uuid lib.
  try {
    // @ts-ignore - keep it runtime-safe
    return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
      .toString()
      .slice(0, 12);
  } catch {
    return `${Date.now()}-${Math.random()}`.slice(0, 12);
  }
}

function safeJson(value: unknown, maxLen = 4000): string {
  try {
    const s = JSON.stringify(value);
    if (typeof s !== "string") return String(s);
    return s.length > maxLen ? s.slice(0, maxLen) + "…<truncated>" : s;
  } catch (e) {
    return `<unserializable: ${(e as any)?.message ?? String(e)}>`;
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `${digits.slice(0, Math.max(0, digits.length - 4)).replace(/./g, "x")}${digits.slice(-4)}`;
}

function toErr(e: unknown): { name?: string; message: string; stack?: string } {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
  return { message: typeof e === "string" ? e : safeJson(e) };
}

@ApiTags("sms-callback")
@Controller("sms-callback")
export class SmsCallbackController {
  private readonly logger = new Logger(SmsCallbackController.name);

  constructor(
    private readonly readymode: ReadymodeService,
    private readonly state: SmsFlowStateService,
    private readonly orchestrator: LeadOrchestratorService,
    private readonly mapping: ReadymodeMappingService,
    private readonly reservationFinder: ReservationFinderService,
  ) {}

  @Post("appointment-booked")
  @ApiOperation({ summary: "Scrub lead and schedule future injection" })
  @ApiBody({ type: AppointmentDto })
  @ApiResponse({ status: 201, type: ReadymodeResponseDto })
  async handleAppointment(@Body() body: AppointmentDto) {
    const rid = newRid();
    const t0 = nowMs();

    this.logger.log(`[${rid}] [Appt] start body=${safeJson(body, 1500)}`);

    if (!body.event_time) {
      this.logger.warn(`[${rid}] [Appt] missing event_time`);
      throw new HttpException("event_time is required", HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`[${rid}] [Appt] booking phone=${maskPhone(body.phone)} at=${body.event_time}`);

    const pointer = await this.orchestrator.getPointer(body.phone);
    this.logger.debug(`[${rid}] [Appt] pointer=${safeJson(pointer, 1500)}`);

    if (pointer?.currentLocation) {
      this.logger.log(
        `[${rid}] [Appt] scrub from pointer domain=${pointer.currentLocation.domain}`,
      );
      try {
        await this.readymode.scrubLead(body.phone, pointer.currentLocation.domain as DialerDomain);
        this.logger.log(`[${rid}] [Appt] scrub ok`);
      } catch (e) {
        this.logger.warn(`[${rid}] [Appt] scrub failed err=${safeJson(toErr(e))}`);
      }
    } else {
      this.logger.warn(`[${rid}] [Appt] pointer missing, default scrub=ODS`);
      try {
        await this.readymode.scrubLead(body.phone, DialerDomain.ODS);
        this.logger.log(`[${rid}] [Appt] ODS scrub ok`);
      } catch (e) {
        this.logger.warn(`[${rid}] [Appt] ODS scrub failed err=${safeJson(toErr(e))}`);
      }
    }

    const dateObj = new Date(body.event_time);
    const dateStr = dateObj.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    });

    const infoString = `Scheduled: ${dateStr}`;
    this.logger.log(`[${rid}] [Appt] scheduleInjection at=${body.event_time} info="${infoString}"`);

    const existingContext = (await this.state.getContext(body.phone)) || {};
    this.logger.debug(`[${rid}] [Appt] existingContext=${safeJson(existingContext, 2000)}`);

    await this.state.saveContext(body.phone, {
      ...existingContext,
      sourceUrl: infoString,
      notes: `SMS Appointment Booked - ${infoString}`,
    });

    await this.state.scheduleInjection(body.phone, body.event_time);

    this.logger.log(`[${rid}] [Appt] done ms=${nowMs() - t0}`);
    return { status: "success", message: "Appointment Processed" };
  }

  @Post("disposition")
  @ApiOperation({ summary: "Handle post-call disposition: Scrub & Recycle (Supports URL Params)" })
  @ApiBody({ type: DispositionDto, required: false })
  @ApiQuery({ name: "phoneNumber", required: false, description: "Dialer URL Param Support" })
  async handleDisposition(@Body() body: Partial<DispositionDto>, @Query() query: any) {
    const rid = newRid();
    const t0 = nowMs();

    this.logger.log(
      `[${rid}] [Dispo] start body=${safeJson(body, 2000)} query=${safeJson(query, 2000)}`,
    );

    const phoneInput = body?.phone || body?.phoneNumber || query?.phone || query?.phoneNumber;
    const campaign_name = body?.campaign_name || query?.campaign || "ODR_Auto_Return";
    const disposition = body?.disposition || query?.disposition || "Manual Return";

    if (!phoneInput) {
      this.logger.warn(`[${rid}] [Dispo] missing phone input`);
      throw new HttpException("Missing phone number (phoneNumber)", HttpStatus.BAD_REQUEST);
    }

    const phoneNumber = new PhoneNumber(phoneInput);
    const phone = phoneNumber.withOnePrefix;

    this.logger.log(
      `[${rid}] [Dispo] resolved phone=${
        maskPhone(phone)
      } dispo="${disposition}" campaign="${campaign_name}"`,
    );

    const pointer = await this.orchestrator.getPointer(phone);
    let context = await this.state.getContext(phone);

    this.logger.debug(`[${rid}] [Dispo] pointer=${safeJson(pointer, 2500)}`);
    this.logger.debug(`[${rid}] [Dispo] context=${safeJson(context, 2500)}`);

    if (!context || !(context as any).reservationId) {
      this.logger.warn(`[${rid}] [Dispo] missing reservationId; enriching via ReservationFinder`);
      try {
        const record = await this.reservationFinder.findByPhone(phoneNumber);
        context = {
          ...context,
          reservationId: String((record as any).ReservationId),
          firstName: (record as any).GuestFullName || "Guest",
          lastName: (record as any).SpouseFullName || "",
          email: (record as any).EmailAddress || "",
          address: (record as any).Address || "",
          city: (record as any).City || "",
          state: (record as any).StateAdjust || "",
          zip: (record as any).PostalCode || "",
        } as any;
        this.logger.log(
          `[${rid}] [Dispo] enriched reservationId=${(context as any)?.reservationId ?? "null"}`,
        );
      } catch (e) {
        this.logger.warn(`[${rid}] [Dispo] reservationFinder failed err=${safeJson(toErr(e))}`);
      }
    }

    const pointerSaysODR = pointer?.currentLocation?.domain === "monsterodr";
    const webhookSaysODR = String(campaign_name).toUpperCase().includes("ODR");

    this.logger.log(
      `[${rid}] [Dispo] gate webhookSaysODR=${webhookSaysODR} pointerSaysODR=${pointerSaysODR} pointerDomain=${
        pointer?.currentLocation?.domain ?? "null"
      }`,
    );

    if (
      String(disposition).toLowerCase() === "sale" || String(disposition).toLowerCase() === "booked"
    ) {
      this.logger.log(`[${rid}] [Dispo] sale/booked => no recycle`);
      return { status: "success", message: "Sale recorded" };
    }

    if (webhookSaysODR || pointerSaysODR) {
      this.logger.warn(`[${rid}] [Dispo] ODR return logic triggered`);

      try {
        this.logger.log(`[${rid}] [Dispo] scrubLead domain=ODR start`);
        await this.readymode.scrubLead(phone, DialerDomain.ODR);
        this.logger.log(`[${rid}] [Dispo] scrubLead domain=ODR ok`);
      } catch (e) {
        this.logger.warn(`[${rid}] [Dispo] scrubLead domain=ODR failed err=${safeJson(toErr(e))}`);
      }

      if (!pointer?.originalSource) {
        this.logger.error(`[${rid}] [Dispo] missing pointer.originalSource (cannot return)`);
        return { status: "error", message: "Lost Lead - No Source History" };
      }

      const source = pointer.originalSource;
      this.logger.log(
        `[${rid}] [Dispo] originalSource domain=${source.domain} campaignId=${source.campaignId}`,
      );

      const resolvedConfig = getCampaignConfig(source.campaignId);
      const targetCampaignId = resolvedConfig?.id || source.campaignId;

      this.logger.log(
        `[${rid}] [Dispo] resolvedCampaign targetCampaignId=${targetCampaignId} resolved=${!!resolvedConfig}`,
      );

      const standardLead: StandardLead = {
        phone,
        firstName: (context as any)?.firstName,
        lastName: (context as any)?.lastName,
        email: (context as any)?.email,
        reservationId: (context as any)?.reservationId,
        ...(context as any),
        notes: `Returned from ODR - Dispo: ${disposition}`,
      };

      if (!standardLead.reservationId) {
        this.logger.warn(
          `[${rid}] [Dispo] reservationId missing on standardLead (injection may be incomplete)`,
        );
      }

      const dialerPayload = this.mapping.denormalize(source.domain as DialerDomain, standardLead);
      this.logger.debug(`[${rid}] [Dispo] dialerPayload=${safeJson(dialerPayload, 2500)}`);

      try {
        this.logger.log(
          `[${rid}] [Dispo] injectLead start domain=${source.domain} campaignId=${targetCampaignId}`,
        );
        const injectResult = await this.readymode.injectLead(
          dialerPayload as ReadymodeLeadDto,
          source.domain as DialerDomain,
          targetCampaignId,
        );
        this.logger.log(`[${rid}] [Dispo] injectLead ok result=${safeJson(injectResult, 2000)}`);
      } catch (e) {
        this.logger.error(
          `[${rid}] [Dispo] injectLead FAILED domain=${source.domain} campaignId=${targetCampaignId} err=${
            safeJson(toErr(e))
          }`,
        );
        throw e;
      }

      try {
        this.logger.log(`[${rid}] [Dispo] updatePointer start`);
        await this.orchestrator.updatePointer(phone, {
          status: "RETURNED_TO_SOURCE",
          currentLocation: {
            domain: source.domain,
            campaignId: targetCampaignId,
            timestamp: Date.now(),
          },
        });
        this.logger.log(`[${rid}] [Dispo] updatePointer ok`);
      } catch (e) {
        this.logger.error(`[${rid}] [Dispo] updatePointer FAILED err=${safeJson(toErr(e))}`);
        throw e;
      }

      this.logger.log(`[${rid}] [Dispo] done ms=${nowMs() - t0}`);
      return { status: "success", message: "Returned to Source" };
    }

    this.logger.log(`[${rid}] [Dispo] standard recycle path campaign="${campaign_name}"`);
    const sourceConfig = getCampaignConfig(campaign_name);

    if (!sourceConfig) {
      this.logger.warn(`[${rid}] [Dispo] unknown campaign; scrub MONSTER`);
      try {
        await this.readymode.scrubLead(phone, DialerDomain.MONSTER);
        this.logger.log(`[${rid}] [Dispo] scrub MONSTER ok`);
      } catch (e) {
        this.logger.error(`[${rid}] [Dispo] scrub MONSTER failed err=${safeJson(toErr(e))}`);
      }
      return { status: "success", message: "Scrubbed (Unknown Campaign)" };
    }

    try {
      await this.readymode.scrubLead(phone, sourceConfig.domain, sourceConfig.id);
      this.logger.log(
        `[${rid}] [Dispo] source scrub ok domain=${sourceConfig.domain} id=${sourceConfig.id}`,
      );
    } catch (e) {
      this.logger.warn(
        `[${rid}] [Dispo] source scrub failed (non-fatal) err=${safeJson(toErr(e))}`,
      );
    }

    if (sourceConfig.recycleTarget) {
      const targetConfig = CAMPAIGN_MASTER_MAP[sourceConfig.recycleTarget];
      if (targetConfig) {
        this.logger.log(`[${rid}] [Dispo] recycle target=${targetConfig.name}`);

        const standardLead: StandardLead = {
          phone,
          firstName: (context as any)?.firstName,
          lastName: (context as any)?.lastName,
          reservationId: (context as any)?.reservationId,
          ...(context as any),
          notes: `Recycled from ${sourceConfig.name}`,
        };

        const recyclePayload = this.mapping.denormalize(targetConfig.domain, standardLead);
        this.logger.debug(`[${rid}] [Dispo] recyclePayload=${safeJson(recyclePayload, 2500)}`);

        const result = await this.readymode.injectLead(
          recyclePayload as ReadymodeLeadDto,
          targetConfig.domain,
          targetConfig.id,
        );

        this.logger.log(`[${rid}] [Dispo] recycled ok result=${safeJson(result, 2000)}`);
        this.logger.log(`[${rid}] [Dispo] done ms=${nowMs() - t0}`);
        return { status: "success", message: `Recycled to ${targetConfig.name}` };
      }
    }

    this.logger.log(`[${rid}] [Dispo] scrubbed only; no recycle target; ms=${nowMs() - t0}`);
    return { status: "success", message: "Scrubbed (No recycle target)" };
  }

  @Post("stop")
  @ApiOperation({ summary: "Handle STOP request: Global DNC" })
  @ApiBody({ type: PhoneDto })
  async handleStop(@Body() body: PhoneDto) {
    const rid = newRid();
    const t0 = nowMs();

    this.logger.warn(
      `[${rid}] [STOP] start phone=${maskPhone(body.phone)} body=${safeJson(body, 1200)}`,
    );

    await this.state.storeMessage(
      body.phone,
      "DNC_REQUEST",
      "Guest",
      "STOP / Opt-out",
      "STOP",
      true,
    );

    const results = await this.readymode.dncGlobal(body.phone);
    this.logger.log(`[${rid}] [STOP] done ms=${nowMs() - t0} results=${safeJson(results, 2000)}`);

    return { status: "success", results };
  }

  @Post("bland/talk-now")
  @ApiOperation({ summary: "Immediate Injection: Scrub source -> Inject to ODR Appts" })
  @ApiBody({ type: PhoneDto })
  async handleTalkNow(@Body() body: PhoneDto) {
    const rid = newRid();
    const t0 = nowMs();

    const phoneInput = body.phoneNumber || body.phone;
    this.logger.log(`[${rid}] [TalkNow] start body=${safeJson(body, 1500)}`);

    if (!phoneInput) throw new HttpException("Phone required", HttpStatus.BAD_REQUEST);

    const phoneNumber = new PhoneNumber(phoneInput);
    const phone = phoneNumber.withOnePrefix;

    let context = await this.state.getContext(phone);
    this.logger.debug(`[${rid}] [TalkNow] context=${safeJson(context, 2500)}`);

    if (context && (context as any).domain) {
      try {
        await this.readymode.scrubLead(phone, (context as any).domain as DialerDomain);
        this.logger.log(`[${rid}] [TalkNow] scrub ok domain=${(context as any).domain}`);
      } catch (e) {
        this.logger.error(`[${rid}] [TalkNow] scrub failed err=${safeJson(toErr(e))}`);
      }
    }

    if (!context || !(context as any).reservationId) {
      try {
        const record = await this.reservationFinder.findByPhone(phoneNumber);
        context = {
          ...context,
          reservationId: String((record as any).ReservationId),
          firstName: (record as any).GuestFullName,
        } as any;
        this.logger.log(
          `[${rid}] [TalkNow] enriched reservationId=${(context as any)?.reservationId ?? "null"}`,
        );
      } catch (_e) {
        this.logger.warn(`[${rid}] [TalkNow] enrichment failed`);
      }
    }

    const TARGET_NAME = "ODR - Appointments";
    const target = getCampaignConfig(TARGET_NAME);
    if (!target) {
      throw new HttpException("Target Campaign Config Missing", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const infoString = "Hot Lead: Talk Now from Bland SMS";
    const standardLead: StandardLead = {
      phone,
      firstName: (context as any)?.firstName,
      lastName: (context as any)?.lastName,
      reservationId: (context as any)?.reservationId,
      ...(context as any),
      notes: infoString,
    };

    const odrPayload = this.mapping.denormalize(target.domain, standardLead);

    const result = await this.readymode.injectLead(
      odrPayload as ReadymodeLeadDto,
      target.domain,
      target.id,
    );

    this.logger.log(`[${rid}] [TalkNow] done ms=${nowMs() - t0} result=${safeJson(result, 1500)}`);
    return { status: "success", message: `Injected to ${TARGET_NAME}`, result };
  }

  // Optional: if you keep accidentally firing this with a browser/curl GET,
  // add a GET alias so you can test quickly and still get logs.
  @Get("return-to-source")
  @ApiOperation({
    summary: "Return lead from ODR to original source (GET alias for debugging)",
    description: "DEBUG ONLY: same as POST /return-to-source but allows testing from browser/URL.",
  })
  @ApiQuery({ name: "phoneNumber", required: false })
  async returnToSourceGetAlias(@Query() query: Record<string, string>) {
    return await this.returnToSource({}, query);
  }

  @Post("return-to-source")
  @ApiOperation({
    summary: "Return lead from ODR to original source",
    description:
      "Scrubs from ODR, retrieves original source from KV pointer, and injects back to source campaign.",
  })
  @ApiBody({ type: PhoneDto, required: false })
  @ApiQuery({ name: "phoneNumber", required: false, description: "Dialer URL Param Support" })
  async returnToSource(@Body() body: Partial<PhoneDto>, @Query() query: Record<string, string>) {
    const rid = newRid();
    const t0 = nowMs();

    this.logger.log(
      `[${rid}] [ReturnToSource] start body=${safeJson(body, 2000)} query=${safeJson(query, 2000)}`,
    );

    const phoneInput = body?.phone || body?.phoneNumber || query?.phone || query?.phoneNumber;
    if (!phoneInput) {
      this.logger.warn(`[${rid}] [ReturnToSource] missing phone input`);
      throw new HttpException("Missing phone number (phoneNumber)", HttpStatus.BAD_REQUEST);
    }

    let phoneNumber: PhoneNumber;
    let phone: string;

    try {
      phoneNumber = new PhoneNumber(phoneInput);
      phone = phoneNumber.withOnePrefix;
    } catch (e) {
      this.logger.error(
        `[${rid}] [ReturnToSource] phone parse failed phoneInput=${safeJson(phoneInput)} err=${
          safeJson(toErr(e))
        }`,
      );
      throw new HttpException("Invalid phone number", HttpStatus.BAD_REQUEST);
    }

    this.logger.log(
      `[${rid}] [ReturnToSource] normalized phone=${maskPhone(phone)} raw=${safeJson(phoneInput)}`,
    );

    // Pointer fetch
    let pointer: any;
    try {
      pointer = await this.orchestrator.getPointer(phone);
      this.logger.debug(`[${rid}] [ReturnToSource] pointer=${safeJson(pointer, 3000)}`);
    } catch (e) {
      this.logger.error(`[${rid}] [ReturnToSource] getPointer FAILED err=${safeJson(toErr(e))}`);
      throw e;
    }

    if (!pointer?.originalSource) {
      this.logger.error(
        `[${rid}] [ReturnToSource] NO originalSource; pointer=${safeJson(pointer, 2500)}`,
      );
      throw new HttpException("No original source found for this lead", HttpStatus.NOT_FOUND);
    }

    // Scrub from ODR
    try {
      this.logger.log(`[${rid}] [ReturnToSource] scrubLead domain=ODR start`);
      await this.readymode.scrubLead(phone, DialerDomain.ODR);
      this.logger.log(`[${rid}] [ReturnToSource] scrubLead domain=ODR ok`);
    } catch (e) {
      // scrub failing may still allow return to source; keep going but log loudly
      this.logger.warn(
        `[${rid}] [ReturnToSource] scrubLead domain=ODR failed err=${safeJson(toErr(e))}`,
      );
    }

    // Context
    let context: any = null;
    try {
      context = await this.state.getContext(phone);
      this.logger.debug(`[${rid}] [ReturnToSource] context=${safeJson(context, 3000)}`);
    } catch (e) {
      this.logger.warn(`[${rid}] [ReturnToSource] getContext failed err=${safeJson(toErr(e))}`);
    }

    const source = pointer.originalSource;
    this.logger.log(
      `[${rid}] [ReturnToSource] originalSource domain=${source.domain} campaignId=${source.campaignId}`,
    );

    const resolvedConfig = getCampaignConfig(source.campaignId);
    const targetCampaignId = resolvedConfig?.id || source.campaignId;

    this.logger.log(
      `[${rid}] [ReturnToSource] campaign resolve input=${source.campaignId} resolved=${!!resolvedConfig} targetCampaignId=${targetCampaignId}`,
    );

    const standardLead: StandardLead = {
      phone,
      firstName: context?.firstName,
      lastName: context?.lastName,
      email: context?.email,
      reservationId: context?.reservationId,
      ...context,
      notes: `Returned from ODR`,
    };

    if (!standardLead.reservationId) {
      this.logger.warn(
        `[${rid}] [ReturnToSource] reservationId missing; lead may inject but be incomplete context=${
          safeJson(context, 2000)
        }`,
      );
    }

    let dialerPayload: unknown;
    try {
      dialerPayload = this.mapping.denormalize(source.domain as DialerDomain, standardLead);
      this.logger.debug(`[${rid}] [ReturnToSource] dialerPayload=${safeJson(dialerPayload, 3500)}`);
    } catch (e) {
      this.logger.error(
        `[${rid}] [ReturnToSource] mapping.denormalize FAILED err=${safeJson(toErr(e))}`,
      );
      throw e;
    }

    // Inject
    let injectResult: unknown;
    try {
      this.logger.log(
        `[${rid}] [ReturnToSource] injectLead start domain=${source.domain} campaignId=${targetCampaignId}`,
      );
      injectResult = await this.readymode.injectLead(
        dialerPayload as ReadymodeLeadDto,
        source.domain as DialerDomain,
        targetCampaignId,
      );
      this.logger.log(
        `[${rid}] [ReturnToSource] injectLead ok result=${safeJson(injectResult, 2500)}`,
      );
    } catch (e) {
      this.logger.error(
        `[${rid}] [ReturnToSource] injectLead FAILED domain=${source.domain} campaignId=${targetCampaignId} err=${
          safeJson(toErr(e))
        }`,
      );
      throw e;
    }

    // Pointer update
    try {
      this.logger.log(`[${rid}] [ReturnToSource] updatePointer start`);
      await this.orchestrator.updatePointer(phone, {
        status: "RETURNED_TO_SOURCE",
        currentLocation: {
          domain: source.domain,
          campaignId: targetCampaignId,
          timestamp: Date.now(),
        },
      });
      this.logger.log(`[${rid}] [ReturnToSource] updatePointer ok`);
    } catch (e) {
      this.logger.error(`[${rid}] [ReturnToSource] updatePointer FAILED err=${safeJson(toErr(e))}`);
      throw e;
    }

    this.logger.log(`[${rid}] [ReturnToSource] done ms=${nowMs() - t0}`);
    return { status: "success", message: "Returned to Source", source, injectResult };
  }

  @Delete("conversation-history")
  @ApiOperation({
    summary: "Delete conversation history for a phone number",
    description: "Deletes all conversation messages and call history for a specific phone number.",
  })
  @ApiBody({
    type: PhoneDto,
    schema: {
      example: {
        phone: "8432222986",
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Conversation history deleted",
    schema: {
      example: {
        status: "success",
        phone: "8432222986",
        deleted: 8,
      },
    },
  })
  async deleteConversationHistory(@Body() body: PhoneDto) {
    const rid = newRid();
    const t0 = nowMs();

    const phoneNumber = new PhoneNumber(body.phone);
    const phone = phoneNumber.withOnePrefix;

    this.logger.warn(
      `[${rid}] [DeleteHistory] start phone=${maskPhone(phone)} body=${safeJson(body, 1200)}`,
    );

    const deleted = await this.state.deleteConversations(phone);

    this.logger.warn(`[${rid}] [DeleteHistory] done ms=${nowMs() - t0} deleted=${deleted}`);

    return { status: "success", phone, deleted };
  }

  @Delete("cleanup")
  @ApiOperation({
    summary: "Reset guest to fresh state (Testing Only)",
    description:
      "Deletes ALL KV entries for a phone number including: SMS flow context, conversations, lead pointer, lead history, rate limits, injection locks, and scheduled injections. Use this to simulate a completely fresh guest for testing.",
  })
  @ApiBody({
    type: PhoneDto,
    schema: {
      example: {
        phone: "8432222986",
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "All KV entries deleted",
  })
  async cleanupPhone(@Body() body: PhoneDto) {
    const rid = newRid();
    const t0 = nowMs();

    const phoneNumber = new PhoneNumber(body.phone);
    const phone = phoneNumber.withOnePrefix;

    this.logger.warn(
      `[${rid}] [Cleanup] start phone=${maskPhone(phone)} body=${safeJson(body, 1200)}`,
    );

    this.logger.warn(`[${rid}] [Cleanup] scrubLead domain=ODR start`);
    try {
      await this.readymode.scrubLead(phone, DialerDomain.ODR);
      this.logger.warn(`[${rid}] [Cleanup] scrubLead domain=ODR ok`);
    } catch (e) {
      this.logger.warn(`[${rid}] [Cleanup] scrubLead domain=ODR failed err=${safeJson(toErr(e))}`);
    }

    const result = await this.state.deleteAllForPhone(phone);

    this.logger.warn(
      `[${rid}] [Cleanup] done ms=${nowMs() - t0} deleted=${(result as any)?.deleted} categories=${
        safeJson((result as any)?.categories, 2000)
      }`,
    );

    return {
      status: "success",
      phone,
      deleted: (result as any).deleted,
      categories: (result as any).categories,
    };
  }

  @Post("backfill-conversations")
  @ApiOperation({
    summary: "Backfill initial Bland message for conversation IDs",
    description:
      "Given a list of Bland conversation IDs, fetches each from Bland's API and stores the first AGENT message in KV. Use this to populate history for conversations that happened before initial-message storage was implemented.",
  })
  @ApiBody({
    schema: {
      example: {
        conversationIds: ["convo_abc123", "convo_def456"],
      },
    },
  })
  async backfillConversations(@Body() body: { conversationIds: string[] }) {
    const rid = newRid();
    const t0 = nowMs();

    const ids: string[] = body?.conversationIds ?? [];
    if (!ids.length) throw new HttpException("conversationIds is required", HttpStatus.BAD_REQUEST);

    const apiKey = Deno.env.get("BLAND_API_KEY") ?? Deno.env.get("NU_BLAND_API_KEY") ?? "";
    const results: Record<string, string> = {};

    for (const conversationId of ids) {
      try {
        const resp = await fetch(`https://api.bland.ai/v1/sms/conversations/${conversationId}`, {
          headers: { authorization: apiKey },
        });
        const json = await resp.json();

        const phone: string = json.data?.user_number ?? "";
        const messages: { sender: string; message: string }[] = json.data?.messages ?? [];
        const first = messages.find((m) => m.sender === "AGENT");

        if (!phone) {
          results[conversationId] = "error: no user_number in response";
          continue;
        }

        if (!first) {
          results[conversationId] = "skipped: no AGENT message found";
          continue;
        }

        const clean = phone.replace(/\D/g, "").slice(-10);
        await this.state.storeMessage(clean, conversationId, "AI Bot", first.message);
        results[conversationId] = `stored: "${first.message.slice(0, 60)}…"`;
      } catch (e: unknown) {
        results[conversationId] = `error: ${(e as Error).message}`;
      }
    }

    this.logger.log(`[${rid}] [Backfill] done ms=${nowMs() - t0} results=${safeJson(results)}`);
    return { status: "success", processed: ids.length, results };
  }

  @Get("list-today")
  @ApiOperation({
    summary: "List all of today's Bland conversation IDs",
    description:
      "Returns all conversation IDs (+ phone + message_count) created today (UTC midnight → now). Use this to review and pick which ones to pass to seed-conversations.",
  })
  async listToday() {
    const rid = newRid();
    const t0 = nowMs();

    const apiKey = Deno.env.get("BLAND_API_KEY") ?? Deno.env.get("NU_BLAND_API_KEY") ?? "";

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const filters = JSON.stringify([
      { field: "created_at", operator: "gte", value: todayStart.toISOString() },
    ]);

    const conversations: { id: string; phone: string; messageCount: number; createdAt: string }[] = [];
    let page = 1;

    this.logger.log(`[${rid}] [ListToday] from=${todayStart.toISOString()}`);

    while (true) {
      const url = new URL("https://api.bland.ai/v1/sms/conversations");
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("sortBy", "created_at");
      url.searchParams.set("sortDir", "asc");
      url.searchParams.set("filters", filters);

      const resp = await fetch(url.toString(), { headers: { authorization: apiKey } });
      const json = await resp.json();

      if (!resp.ok || !json?.data) {
        throw new HttpException(`Bland list API error (${resp.status})`, HttpStatus.BAD_GATEWAY);
      }

      for (const c of json.data as { id: string; user_number: string; message_count: number; created_at: string }[]) {
        conversations.push({ id: c.id, phone: c.user_number, messageCount: c.message_count, createdAt: c.created_at });
      }

      this.logger.log(`[${rid}] [ListToday] page=${page} got=${json.data.length} total=${conversations.length}`);

      if (page >= (json.extra?.pagination?.totalPages ?? 1)) break;
      page++;
    }

    this.logger.log(`[${rid}] [ListToday] done ms=${nowMs() - t0} total=${conversations.length}`);

    return {
      total: conversations.length,
      from: todayStart.toISOString(),
      conversations,
      conversationIds: conversations.map((c) => c.id),
    };
  }

  @Post("seed-conversations")
  @ApiOperation({
    summary: "Bulk seed full conversation history for multiple IDs",
    description:
      "Given an array of Bland conversation IDs, fetches all messages for each and stores them in KV. Idempotent — re-seeding the same ID overwrites existing entries.",
  })
  @ApiBody({
    schema: {
      example: { conversationIds: ["convo_abc123", "convo_def456"] },
    },
  })
  async seedConversations(@Body() body: { conversationIds: string[] }) {
    const rid = newRid();
    const t0 = nowMs();

    const ids: string[] = body?.conversationIds ?? [];
    if (!ids.length) throw new HttpException("conversationIds is required", HttpStatus.BAD_REQUEST);

    const apiKey = Deno.env.get("BLAND_API_KEY") ?? Deno.env.get("NU_BLAND_API_KEY") ?? "";
    this.logger.log(`[${rid}] [SeedBulk] starting ids=${ids.length}`);

    const results: Record<string, { status: string; stored?: number; skipped?: number; error?: string }> = {};

    for (const conversationId of ids) {
      try {
        const resp = await fetch(`https://api.bland.ai/v1/sms/conversations/${conversationId}`, {
          headers: { authorization: apiKey },
        });
        const json = await resp.json();

        if (!resp.ok || !json?.data) {
          results[conversationId] = { status: "error", error: `Bland ${resp.status}: ${JSON.stringify(json?.errors ?? json)}` };
          continue;
        }

        const phone: string = json.data.user_number ?? "";
        if (!phone) {
          results[conversationId] = { status: "error", error: "no user_number in response" };
          continue;
        }

        const clean = phone.replace(/\D/g, "").slice(-10);
        const messages: { sender: string; message: string }[] = json.data.messages ?? [];

        // Overwrite: clear existing entries for this callId (non-fatal if KV unavailable)
        try {
          const existing = await this.state.list(["conversations", clean, conversationId]);
          for (const entry of existing) await this.state.delete(entry.key);
        } catch (_e) {
          this.logger.warn(`[${rid}] [SeedBulk] ⚠️ ${conversationId} clear existing failed (non-fatal), continuing`);
        }

        let stored = 0;
        let skipped = 0;
        for (const msg of messages) {
          if (!msg.message || msg.message === "<Call Connected>") { skipped++; continue; }
          const sender: "Guest" | "AI Bot" = msg.sender === "USER" ? "Guest" : "AI Bot";
          await this.state.storeMessage(clean, conversationId, sender, msg.message);
          stored++;
          await new Promise((r) => setTimeout(r, 100));
        }

        results[conversationId] = { status: "success", stored, skipped };
        this.logger.log(`[${rid}] [SeedBulk] ✅ ${conversationId} phone=${clean} stored=${stored} skipped=${skipped}`);
        // Delay between conversations to avoid overwhelming remote KV
        await new Promise((r) => setTimeout(r, 300));
      } catch (e: unknown) {
        const errMsg = (e as Error).message;
        this.logger.error(`[${rid}] [SeedBulk] ❌ ${conversationId} err=${errMsg}`);
        results[conversationId] = { status: "error", error: errMsg };
      }
    }

    const succeeded = Object.values(results).filter((r) => r.status === "success").length;
    const failed = Object.values(results).filter((r) => r.status === "error").length;
    this.logger.log(`[${rid}] [SeedBulk] done ms=${nowMs() - t0} succeeded=${succeeded} failed=${failed}`);

    return { status: "done", total: ids.length, succeeded, failed, results };
  }

  @Post("seed-conversation")
  @ApiOperation({
    summary: "Seed full conversation history from Bland into KV",
    description:
      "Given a single Bland conversation ID, fetches all messages and stores each one in KV. USER messages are stored as 'Guest', AGENT messages as 'AI Bot'.",
  })
  @ApiBody({
    schema: {
      example: { conversationId: "convo_abc123" },
    },
  })
  async seedConversation(@Body() body: { conversationId: string }) {
    const rid = newRid();
    const t0 = nowMs();

    const { conversationId } = body;
    if (!conversationId) {
      throw new HttpException("conversationId is required", HttpStatus.BAD_REQUEST);
    }

    const apiKey = Deno.env.get("BLAND_API_KEY") ?? Deno.env.get("NU_BLAND_API_KEY") ?? "";
    this.logger.log(`[${rid}] [SeedConvo] fetching convo=${conversationId} apiKeySet=${!!apiKey}`);

    let resp: Response;
    interface BlandConvoResponse {
      data?: { user_number?: string; messages?: { sender: string; message: string; created_at?: string }[] };
      errors?: unknown;
    }
    let json: BlandConvoResponse;
    try {
      resp = await fetch(`https://api.bland.ai/v1/sms/conversations/${conversationId}`, {
        headers: { authorization: apiKey },
      });
      json = await resp.json();
      this.logger.log(`[${rid}] [SeedConvo] Bland status=${resp.status} keys=${Object.keys(json ?? {}).join(",")}`);
      console.log(`[SeedConvo] 📨 Raw Bland response:`, JSON.stringify(json, null, 2));
    } catch (e: unknown) {
      const msg = (e as Error).message;
      this.logger.error(`[${rid}] [SeedConvo] Bland fetch failed: ${msg}`);
      throw new HttpException(`Bland fetch failed: ${msg}`, HttpStatus.BAD_GATEWAY);
    }

    if (!resp.ok || !json?.data) {
      this.logger.error(`[${rid}] [SeedConvo] Bland error body=${safeJson(json)}`);
      throw new HttpException(
        `Bland API error (${resp.status}): ${JSON.stringify(json?.errors ?? json)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const phone: string = json.data.user_number ?? "";
    this.logger.log(`[${rid}] [SeedConvo] user_number="${phone}" messageCount=${json.data.messages?.length ?? 0}`);
    if (!phone) throw new HttpException("No user_number in Bland response", HttpStatus.BAD_GATEWAY);

    const clean = phone.replace(/\D/g, "").slice(-10);
    const messages: { sender: string; message: string; created_at?: string }[] =
      json.data.messages ?? [];

    // Delete existing entries for this exact callId before re-seeding (idempotent overwrite)
    const existing = await this.state.list(["conversations", clean, conversationId]);
    for (const entry of existing) await this.state.delete(entry.key);
    if (existing.length > 0) {
      this.logger.log(`[${rid}] [SeedConvo] cleared ${existing.length} existing entries for convo=${conversationId}`);
    }

    let stored = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const msg of messages) {
      if (!msg.message || msg.message === "<Call Connected>") {
        skipped++;
        continue;
      }

      const sender: "Guest" | "AI Bot" = msg.sender === "USER" ? "Guest" : "AI Bot";
      try {
        await this.state.storeMessage(clean, conversationId, sender, msg.message);
        stored++;
      } catch (e: unknown) {
        const errMsg = (e as Error).message;
        this.logger.error(`[${rid}] [SeedConvo] storeMessage failed: ${errMsg}`);
        errors.push(errMsg);
      }
    }

    this.logger.log(
      `[${rid}] [SeedConvo] done ms=${nowMs() - t0} convo=${conversationId} stored=${stored} skipped=${skipped} errors=${errors.length}`,
    );

    return {
      status: errors.length === 0 ? "success" : "partial",
      conversationId,
      phone: clean,
      stored,
      skipped,
      errors,
    };
  }
}
