// Cal.com v2 API client. Plain functions over fetch — port of the legacy
// NestJS CalService. Three operations: list synthetic 15-min slots,
// create a booking, cancel a booking.

import {
  CAL_API_BASE,
  CAL_API_VERSION,
  CAL_DEFAULT_TIMEZONE,
  CAL_MONSTER_APPOINTMENTS_EVENT_TYPE_ID,
} from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";

export interface CalBookingResponse {
  data?: {
    uid: string;
    id: number;
    status: string;
    start: string;
    end: string;
  };
  uid?: string;
  status?: string;
}

export interface CreateBookingParams {
  email: string;
  name: string;
  startTime: string;
  timeZone?: string;
  metadata?: Record<string, unknown>;
}

function getApiKey(): string {
  const key = loadEnv().calApiKey;
  if (!key) {
    throw new Error(
      "❌ Missing CAL_API_KEY — add it to env/local or Deno Deploy settings.",
    );
  }
  return key;
}

function headers(): Record<string, string> {
  return {
    "Authorization": `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
    "cal-api-version": CAL_API_VERSION,
  };
}

// "Monster Appointments" event type — hardcoded in legacy as a single
// constant. Wrapped in a getter to mirror the legacy lazy init.
export function getMonsterAppointmentsEventTypeId(): number {
  return CAL_MONSTER_APPOINTMENTS_EVENT_TYPE_ID;
}

// Synthetic 15-min slots, 9am–5pm ET, future-only. Defaults: now+30min → +7d.
// Note: this does NOT consult Cal.com availability; it just enumerates the
// business-hour grid. Overbooking is allowed by design.
export function getAvailableTimes(
  startTime?: string,
  endTime?: string,
): string[] {
  const slots: string[] = [];
  const now = Date.now();
  const start = startTime
    ? new Date(startTime)
    : new Date(now + 30 * 60 * 1000);
  const end = endTime
    ? new Date(endTime)
    : new Date(now + 7 * 24 * 60 * 60 * 1000);

  const businessHoursStart = 9;
  const businessHoursEnd = 17;
  const slotIntervalMinutes = 15;

  let currentDate = new Date(start);
  currentDate.setMinutes(0, 0, 0);

  while (currentDate <= end) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    });
    const hourEST = parseInt(formatter.format(currentDate));
    if (
      hourEST >= businessHoursStart &&
      hourEST < businessHoursEnd &&
      currentDate.getTime() > now
    ) {
      slots.push(currentDate.toISOString());
    }
    currentDate = new Date(
      currentDate.getTime() + slotIntervalMinutes * 60 * 1000,
    );
  }

  console.log(
    `[cal] getAvailableTimes → ${slots.length} slots ` +
      `(${start.toISOString()} → ${end.toISOString()})`,
  );
  return slots;
}

export async function createBooking(
  params: CreateBookingParams,
): Promise<CalBookingResponse> {
  const eventTypeId = getMonsterAppointmentsEventTypeId();
  const payload = {
    eventTypeId,
    start: params.startTime,
    attendee: {
      name: params.name,
      email: params.email,
      timeZone: params.timeZone || CAL_DEFAULT_TIMEZONE,
    },
    metadata: params.metadata || {},
  };

  console.log(
    `[cal] createBooking → ${params.email} @ ${params.startTime}`,
  );

  const response = await fetch(`${CAL_API_BASE}/bookings`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let result: CalBookingResponse;
  try {
    result = JSON.parse(text) as CalBookingResponse;
  } catch {
    throw new Error(`Failed to parse Cal.com response: ${text}`);
  }
  if (!response.ok) {
    throw new Error(
      `Cal.com booking failed: ${response.status} - ${JSON.stringify(result)}`,
    );
  }
  return result;
}

export async function cancelBooking(
  bookingUid: string,
  cancellationReason?: string,
): Promise<{ status: string }> {
  const body = {
    cancellationReason: cancellationReason || "Cancelled via API",
  };

  console.log(`[cal] cancelBooking → ${bookingUid}`);

  const response = await fetch(
    `${CAL_API_BASE}/bookings/${bookingUid}/cancel`,
    {
      method: "DELETE",
      headers: headers(),
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to cancel booking: ${response.status} ${error}`,
    );
  }
  return await response.json();
}
