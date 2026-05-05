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

export const abTestContainer = `${R}/abtest`;
export const abTestCollection = `${abTestContainer}/byPhone`;

export const dncContainer = `${R}/dnc`;
export const dncCollection = `${dncContainer}/byPhone`;

export const configContainer = `${R}/config`;
export const configSettingsCollection = `${configContainer}/settings`;

export function cronConfigDocPath(): string {
  return `${configSettingsCollection}/cronConfig`;
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
export function globalSmsCountDocPath(easternDate: string): string {
  return `${globalSmsCountCollection}/${easternDate}`;
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
