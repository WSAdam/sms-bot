export interface SmsFlowContext {
  domain: string;
  campaignId: string;
  reservationId?: string;
  phone: string;
  leadId?: string;
  destination?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  sourceUrl?: string;
  timestamp: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: unknown;
}
