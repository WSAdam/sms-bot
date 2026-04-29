import type { DialerDomain } from "@shared/types/readymode.ts";

export interface LeadLocation {
  domain: DialerDomain;
  campaignId: string;
  timestamp: number;
}

export type LeadPointerStatus =
  | "ACTIVE"
  | "SCRUBBED"
  | "SCHEDULED_FOR_ODR"
  | "IN_ODR"
  | "RETURNED_TO_SOURCE";

export interface LeadPointer {
  phone: string;
  currentLocation: LeadLocation | null;
  originalSource: LeadLocation | null;
  status: LeadPointerStatus;
  lastAction: string;
}

export type OrchestratorAction =
  | "INJECT"
  | "SCRUB"
  | "DNC"
  | "APPT_SCHEDULED"
  | "INIT"
  | "SCHEDULE_TIMER";

export interface OrchestratorEvent {
  action: OrchestratorAction;
  domain: DialerDomain;
  campaignId?: string;
  details?: string;
  timestamp: number;
}
