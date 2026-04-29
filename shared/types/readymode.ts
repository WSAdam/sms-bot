// Inbound + outbound DTOs for the ReadyMode pipeline. Stripped of
// class-validator/swagger decorators — just plain TS shapes.

export enum DialerDomain {
  ACT = "monsteract",
  ODS = "monsterods",
  ODR = "monsterodr",
  DS = "monsterrd2",
  MONSTER = "monsterrg",
}

export interface PhoneDto {
  phone: string;
  phoneNumber?: string;
}

export interface AppointmentDto extends PhoneDto {
  event_time?: string;
  calendly_invitee_uri?: string;
}

export interface DispositionDto extends PhoneDto {
  disposition?: string;
  campaign_name?: string;
}

export interface ReadymodeLeadDto {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  campaign?: string;
  notes?: string;
  isTest?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: unknown;
}

export interface ReadymodeResponseDto {
  message: string;
  status: "success" | "error" | "skipped";
}

export interface StandardLead {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  reservationId?: string;
  destination?: string;
  desiredDestination1?: string;
  desiredDestination2?: string;
  desiredDate1?: string;
  desiredDate2?: string;
  leadDate?: string;
  dateOfBooking?: string;
  resortName?: string;
  spouseAge?: string;
  maritalStatus?: string;
  income?: string;
  notes?: string;
  numAdults?: string;
  numChildren?: string;
  guestAge?: string;
  office?: string;
  urlLinkToRecord?: string;
  totalPrice?: string;
}

export interface DomainConfig {
  baseUrl: string;
  channels: Record<string, string>;
}

export interface CampaignConfig {
  id: string;
  domain: DialerDomain;
  name: string;
  recycleTarget?: string;
  aggregateGroup?: string;
  table?: string;
  report?: string;
}
