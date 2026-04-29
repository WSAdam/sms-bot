import { IsBoolean, IsOptional, IsString } from "#class-validator";
import { ApiProperty } from "#nestjs/swagger";

export enum DialerDomain {
  ACT = "monsteract",
  ODS = "monsterods",
  ODR = "monsterodr",
  DS = "monsterrd2",
  MONSTER = "monsterrg",
}

/**
 * Minimal phone-only DTO.
 * Base for all phone-based operations.
 */
export class PhoneDto {
  @ApiProperty({ example: "8432222986" })
  @IsString()
  phone!: string;

  @ApiProperty({ example: "8432222986", required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

/**
 * DTO for appointment-related operations.
 * Used when scheduling or booking appointments.
 */
export class AppointmentDto extends PhoneDto {
  @ApiProperty({ example: "2026-01-20T14:30:00.000Z", required: false })
  @IsOptional()
  @IsString()
  event_time?: string;

  @ApiProperty({
    example: "https://api.calendly.com/scheduled_events/abc123/invitees/def456",
    required: false,
  })
  @IsOptional()
  @IsString()
  calendly_invitee_uri?: string;
}

/**
 * DTO for call disposition operations.
 * Used for post-call dispositions and recycling.
 */
export class DispositionDto extends PhoneDto {
  @ApiProperty({ example: "Not Interested", required: false })
  @IsOptional()
  @IsString()
  disposition?: string;

  @ApiProperty({ example: "ODR - Appointments", required: false })
  @IsOptional()
  @IsString()
  campaign_name?: string;
}

/**
 * DTO for deleting scheduled injections.
 */
export class DeleteScheduledInjectionDto extends PhoneDto {
  @ApiProperty({
    example: "iiYvpEq2jbJAaCanZd9AJy",
    description: "Cal.com booking UID to cancel (optional)",
    required: false,
  })
  @IsOptional()
  @IsString()
  bookingUid?: string;
}

export class ReadymodeLeadDto {
  @IsString()
  phone!: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  zip?: string;

  @IsString()
  @IsOptional()
  campaign?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isTest?: boolean;

  // Allow dynamic fields
  [key: string]: any;
}

export class ReadymodeResponseDto {
  @IsString()
  message!: string;

  @IsString()
  status!: "success" | "error" | "skipped";
}

/**
 * Extended DTO for scheduling appointments with Cal.com
 */
export class ScheduleAppointmentDto extends PhoneDto {
  @ApiProperty({ example: "2026-01-28T15:30:00.000Z" })
  @IsString()
  startTime!: string;

  @ApiProperty({ example: "john@example.com" })
  @IsString()
  inviteeEmail!: string;

  @ApiProperty({ example: "John Doe" })
  @IsString()
  inviteeName!: string;

  @ApiProperty({ example: "+18432222986" })
  @IsString()
  inviteePhone!: string;

  @ApiProperty({ example: "America/New_York", required: false })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ example: "56fb2bfd-b452-4936-bb98-b579a0856aa7", required: false })
  @IsOptional()
  @IsString()
  conversationId?: string;
}

/**
 * Extended DTO for storing conversation messages
 */
export class StoreConversationDto extends PhoneDto {
  @ApiProperty({ example: "call-abc123" })
  @IsString()
  callId!: string;

  @ApiProperty({ example: "AI Bot" })
  @IsString()
  sender!: string;

  @ApiProperty({ example: "Hello, how can I help you today?" })
  @IsString()
  message!: string;

  @ApiProperty({ example: "Option", required: false })
  @IsOptional()
  @IsString()
  nodeTag?: string;
}
