import { IsBoolean, IsNumber, IsOptional, IsString } from "#class-validator";
import { Body, Controller, Logger, Post, Query } from "#nestjs/common";
import { ApiBody, ApiOperation, ApiProperty, ApiResponse, ApiTags } from "#nestjs/swagger";
import { PhoneDto } from "@sms-flow/readymode/dto/mod.ts";
import { ReadymodeService } from "@sms-flow/readymode/service/mod.ts";

export class ReadymodeTriggerDto extends PhoneDto {
  @ApiProperty({ example: "282383", description: "CRM Reservation ID" })
  @IsString()
  resID!: string;

  @ApiProperty({ example: "monsterrg", description: "Dialer domain", required: false })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiProperty({ example: 45, description: "Number of dialer attempts", required: false })
  @IsOptional()
  @IsNumber()
  attempts?: number;

  @ApiProperty({ example: "Act Mid 1", description: "Campaign Name", required: false })
  @IsOptional()
  @IsString()
  campaign?: string;

  @ApiProperty({
    example: true,
    description: "Force send: Bypasses Attempts, Rate Limits, and DNC/Opt-Out checks.",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

@ApiTags("SMS Trigger")
@Controller("trigger")
export class SmsTriggerController {
  private readonly logger = new Logger(SmsTriggerController.name);

  constructor(private readonly readymode: ReadymodeService) {}

  @Post("readymode")
  @ApiOperation({
    summary: "Main entry point for Readymode webhooks",
    description:
      "Processes inbound leads from Readymode with gatekeeper logic (40+ attempts, 5k daily limit). Supports &override=true to bypass checks.",
  })
  @ApiBody({ type: ReadymodeTriggerDto })
  @ApiResponse({
    status: 201,
    description: "SMS Processed",
    schema: { example: { status: "success", variant: "A" } },
  })
  @ApiResponse({
    status: 200,
    description: "Lead Skipped",
    schema: { example: { status: "skipped", reason: "Insufficient attempts" } },
  })
  async triggerFromReadymode(
    @Body() body: any,
    @Query() query: any,
    @Query("dialerDomain") queryDomain?: string,
    @Query("campaign") queryCampaign?: string,
  ) {
    // Normalizing payload from diverse dialer webhook formats
    // Merge query and body so URL params like &override=true are captured alongside body JSON
    const rawPayload = { ...query, ...body };

    console.log(`[Trigger] 📥 RAW PAYLOAD: ${JSON.stringify(rawPayload)}`);

    return await this.readymode.processInboundLead(rawPayload);
  }

  @Post("manual")
  @ApiOperation({
    summary: "Manual SMS trigger for testing",
    description:
      "Forces a text to send by setting override=true. Bypasses ALL checks (Attempts, DNC, Rate Limits).",
  })
  @ApiBody({
    type: ReadymodeTriggerDto,
    schema: {
      example: {
        phone: "8432222986",
        resID: "1234567",
        domain: "monsterrg",
        attempts: 1, // Will work because of override
        override: true,
      },
    },
  })
  async manualTrigger(@Body() body: ReadymodeTriggerDto) {
    this.logger.log(`[Trigger] Manual test trigger initiated for ${body.phone}`);

    // Ensure override is forced to true for manual tests
    return await this.readymode.processInboundLead({
      ...body,
      override: true,
    });
  }
}
