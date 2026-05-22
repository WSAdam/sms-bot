// All Firestore paths live here. Mirrors context.md §6 schema. Every collection
// hangs off a single root collection (`sms-bot`) so this whole project's data
// is fully isolated under one collection name.
//
// Schema convention used here:
//   sms-bot/<container>/<subcollection>/<docId>
// where <container> is a fixed doc name and <subcollection> is the actual
// collection of records. e.g.
//   sms-bot/conversations/messages/{phone10}__{callId}__{timestamp}

import { ROOT_COLLECTION as R } from "@shared/config/constants.ts";

// Containers (docs holding subcollections)
export const conversationsContainer = `${R}/conversations`;
export const conversationsCollection = `${conversationsContainer}/messages`;

export const scheduledInjectionsContainer = `${R}/scheduledinjections`;
export const scheduledInjectionsCollection =
  `${scheduledInjectionsContainer}/byPhone`;

export const smsFlowContextContainer = `${R}/smsflowcontext`;
export const smsFlowContextCollection = `${smsFlowContextContainer}/byPhone`;

export const guestActivatedContainer = `${R}/guestactivated`;
export const guestActivatedCollection = `${guestActivatedContainer}/byPhone`;

export const guestAnsweredContainer = `${R}/guestanswered`;
export const guestAnsweredCollection = `${guestAnsweredContainer}/byPhone`;

export const auditContainer = `${R}/audit`;
export const auditCollection = `${auditContainer}/byRecordId`;

export const auditStageContainer = `${R}/auditstage`;
export function auditStageCollection(stage: string): string {
  return `${auditStageContainer}/${stage}`;
}

export const salesWithin7dContainer = `${R}/saleswithin7d`;
export const salesWithin7dCollection = `${salesWithin7dContainer}/byPhone`;

// Activations from QB report 678 that had a scheduled appointment but the
// activation landed OUTSIDE the SALE_MATCH_WINDOW_DAYS day-window.
// Tracked separately so we can see who slipped past our reminder timing.
export const salesOutsideWindowContainer = `${R}/salesoutsidewindow`;
export const salesOutsideWindowCollection =
  `${salesOutsideWindowContainer}/byPhone`;

export const injectionHistoryContainer = `${R}/injectionhistory`;
export const injectionHistoryCollection =
  `${injectionHistoryContainer}/byPhone`;

export const leadPointerContainer = `${R}/leadpointer`;
export const leadPointerCollection = `${leadPointerContainer}/byPhone`;

export const orchestratorEventsContainer = `${R}/orchestratorevents`;
export const orchestratorEventsCollection =
  `${orchestratorEventsContainer}/byPhone`;

export const rateLimitContainer = `${R}/ratelimit`;
export const rateLimitCollection = `${rateLimitContainer}/byPhone`;

export const globalSmsCountContainer = `${R}/globalsmscount`;
export const globalSmsCountCollection = `${globalSmsCountContainer}/byDate`;

// Write-side index for "Texts Sent (unique recipients)" reporting. Each
// phone we send an outbound SMS to gets ONE doc here on first send;
// subsequent sends short-circuit via atomicCreate. Eliminates the need
// for the nightly report to scan the conversations collection. See
// firestore-safety.md (Part B) for the incident context.
export const uniqueRecipientByPhoneContainer = `${R}/uniquerecipientbyphone`;
export const uniqueRecipientByPhoneCollection =
  `${uniqueRecipientByPhoneContainer}/byPhone`;

// Write-side index of "phones we've ever scheduled an injection for".
// One doc per phone, atomicCreate on first scheduleInjection — collapses
// the /api/guests/answered "is this our lead" check from a 50k-limit
// injectionhistory scan to a single doc.get. See firestore-safety.md.
export const injectedPhonesContainer = `${R}/injectedphones`;
export const injectedPhonesCollection = `${injectedPhonesContainer}/byPhone`;

// Write-side aggregator for the dashboard's "Unique Guests Reached"
// drill-in. One doc per phone we've ever messaged, updated transactionally
// from storeMessage. Replaces the 50k conversations scan + in-memory
// dedupe that powered /api/guests/list. See firestore-safety.md.
export const uniqueGuestsByPhoneContainer = `${R}/uniqueguestsbyphone`;
export const uniqueGuestsByPhoneCollection =
  `${uniqueGuestsByPhoneContainer}/byPhone`;

// Write-side daily and lifetime metric counters. Replace the
// scheduledinjections + injectionhistory + guestactivated scans the
// nightly report used to do. Daily docs keyed by ET YYYY-MM-DD, lifetime
// is a single rollup doc. Counters are incremented at each write site
// (scheduleInjection, sale-match guestactivated, outbound SMS marker).
export const metricsDailyContainer = `${R}/metrics`;
export const metricsDailyCollection = `${metricsDailyContainer}/daily`;
export const metricsLifetimeCollection = `${metricsDailyContainer}/lifetime`;
// One doc per Deno.cron job. Stamped at the END of every cron run so
// /api/admin/cron-health can detect silent failures (the daily QB
// sale-match cron 502'd for 16 days before we noticed). Doc shape:
// { lastRunAt, lastStatus: "ok"|"error", lastError?, lastDurationMs }.
export const metricsCronRunsCollection = `${metricsDailyContainer}/cronruns`;
// Per-container row counters for the dashboard's kvBreakdown sidebar.
// Single doc with one field per container — no full-collection scans
// on dashboard load. See plan part 2.C.
export const metricsKvBreakdownCollection =
  `${metricsDailyContainer}/kvBreakdown`;

// Per-week recipient index for the WTD count. Doc id is
// `{weekKey}__{phone10}` so atomicCreate dedupes within the same week.
// `weekKey` is the ISO date of Monday 00:00 ET for that week, e.g.
// "2026-05-11". Stored as a field too so we can `where("weekKey", "==")`.
export const weeklyRecipientByPhoneWeekContainer =
  `${R}/weeklyrecipientbyphoneweek`;
export const weeklyRecipientByPhoneWeekCollection =
  `${weeklyRecipientByPhoneWeekContainer}/byKey`;

export const abTestContainer = `${R}/abtest`;
export const abTestCollection = `${abTestContainer}/byPhone`;

export const dncContainer = `${R}/dnc`;
export const dncCollection = `${dncContainer}/byPhone`;

// ReadyMode portal call dispositions, scraped daily. Doc id is
// `{phone10}__{callLogId}` so re-running the import is idempotent
// (RM's call_log.id is the server-side primary key).
export const callDispositionsContainer = `${R}/calldispositions`;
export const callDispositionsCollection =
  `${callDispositionsContainer}/byPhone`;

export const configContainer = `${R}/config`;
export const configSettingsCollection = `${configContainer}/settings`;

export function cronConfigDocPath(): string {
  return `${configSettingsCollection}/cronConfig`;
}

export function gatesConfigDocPath(): string {
  return `${configSettingsCollection}/gatesConfig`;
}

// Doc-path helpers
export function conversationDocPath(docId: string): string {
  return `${conversationsCollection}/${docId}`;
}
export function scheduledInjectionDocPath(phone10: string): string {
  return `${scheduledInjectionsCollection}/${phone10}`;
}
export function smsFlowContextDocPath(phone10: string): string {
  return `${smsFlowContextCollection}/${phone10}`;
}
export function guestActivatedDocPath(phone10: string): string {
  return `${guestActivatedCollection}/${phone10}`;
}
export function guestAnsweredDocPath(phone10: string): string {
  return `${guestAnsweredCollection}/${phone10}`;
}
export function auditDocPath(recordId: string): string {
  return `${auditCollection}/${recordId}`;
}
export function auditStageDocPath(stage: string, recordId: string): string {
  return `${auditStageCollection(stage)}/${recordId}`;
}
export function salesWithin7dDocPath(phone10: string): string {
  return `${salesWithin7dCollection}/${phone10}`;
}
export function salesOutsideWindowDocPath(phone10: string): string {
  return `${salesOutsideWindowCollection}/${phone10}`;
}
export function injectionHistoryDocPath(docId: string): string {
  return `${injectionHistoryCollection}/${docId}`;
}
export function leadPointerDocPath(phone10: string): string {
  return `${leadPointerCollection}/${phone10}`;
}
export function orchestratorEventDocPath(docId: string): string {
  return `${orchestratorEventsCollection}/${docId}`;
}
export function rateLimitDocPath(phone10: string): string {
  return `${rateLimitCollection}/${phone10}`;
}
export function callDispositionDocPath(
  phone10: string,
  callLogId: string,
): string {
  return `${callDispositionsCollection}/${phone10}__${callLogId}`;
}
export function readymodeCampaignsDocPath(): string {
  return `${configSettingsCollection}/readymodeCampaigns`;
}
export function globalSmsCountDocPath(easternDate: string): string {
  return `${globalSmsCountCollection}/${easternDate}`;
}
export function uniqueRecipientByPhoneDocPath(phone10: string): string {
  return `${uniqueRecipientByPhoneCollection}/${phone10}`;
}
export function weeklyRecipientByPhoneWeekDocPath(
  weekKey: string,
  phone10: string,
): string {
  return `${weeklyRecipientByPhoneWeekCollection}/${weekKey}__${phone10}`;
}
export function injectedPhoneDocPath(phone10: string): string {
  return `${injectedPhonesCollection}/${phone10}`;
}
export function uniqueGuestByPhoneDocPath(phone10: string): string {
  return `${uniqueGuestsByPhoneCollection}/${phone10}`;
}
export function metricsDailyDocPath(easternDate: string): string {
  return `${metricsDailyCollection}/${easternDate}`;
}
export function metricsLifetimeDocPath(): string {
  return `${metricsLifetimeCollection}/totals`;
}
export function metricsCronRunDocPath(cronName: string): string {
  return `${metricsCronRunsCollection}/${cronName}`;
}
export function metricsKvBreakdownDocPath(): string {
  return `${metricsKvBreakdownCollection}/totals`;
}
export function abTestDocPath(phone10: string): string {
  return `${abTestCollection}/${phone10}`;
}
export function dncDocPath(phone10: string): string {
  return `${dncCollection}/${phone10}`;
}
export function configStateDocPath(): string {
  return `${configSettingsCollection}/state`;
}
