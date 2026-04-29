export interface FutureInjection {
  phone: string;
  eventTime: string;
  scheduledAt: number;
  isTest?: boolean;
  calendlyInviteeUri?: string;
}

export interface InjectionHistoryEntry {
  phone: string;
  eventTime: string;
  scheduledAt: number;
  firedAt: string;
  firedBy: "cron" | "manual";
  status: "success" | "error";
  callbackStatus?: number;
  isTest?: boolean;
  error?: string;
}
