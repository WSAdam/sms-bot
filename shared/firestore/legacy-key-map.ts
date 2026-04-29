// Translates legacy Deno.KvKey arrays (e.g. `["audit", recordId]`) into
// Firestore paths under the new schema. Used by the /api/kv/* admin endpoints
// so existing tooling that passes KV-shaped keys keeps working.
//
// If a key shape isn't recognised it falls back to joining segments with `/`
// under the root collection (`sms-bot/...`) so callers can at least round-trip
// experimental data.

import { ROOT_COLLECTION } from "@shared/config/constants.ts";
import {
  abTestDocPath,
  auditDocPath,
  auditStageDocPath,
  conversationDocPath,
  globalSmsCountDocPath,
  guestActivatedDocPath,
  guestAnsweredDocPath,
  injectionHistoryDocPath,
  leadPointerDocPath,
  orchestratorEventDocPath,
  rateLimitDocPath,
  salesWithin7dDocPath,
  scheduledInjectionDocPath,
  smsFlowContextDocPath,
} from "@shared/firestore/paths.ts";
import {
  conversationDocId,
  injectionHistoryDocId,
  orchestratorEventDocId,
} from "@shared/util/id.ts";
import { lookupDocPath } from "@shared/services/conversations/lookup.ts";

export type LegacyKey = Array<string | number>;

export interface LegacyDocPath {
  path: string;
}

export interface LegacyCollectionPath {
  parent: string;
  filterFn?: (id: string) => boolean;
}

export function legacyKeyToDocPath(key: LegacyKey): LegacyDocPath | null {
  if (!Array.isArray(key) || key.length === 0) return null;
  const head = String(key[0]);
  const rest = key.slice(1).map(String);

  switch (head) {
    case "audit":
      if (rest.length === 1) return { path: auditDocPath(rest[0]) };
      return null;

    case "auditstage":
      if (rest.length === 2) return { path: auditStageDocPath(rest[0], rest[1]) };
      return null;

    case "scheduledinjection":
      if (rest.length === 1) return { path: scheduledInjectionDocPath(rest[0]) };
      return null;

    case "smsflowcontext":
    case "sms_flow_context":
      if (rest.length === 1) return { path: smsFlowContextDocPath(rest[0]) };
      return null;

    case "guestactivated":
      if (rest.length === 1) return { path: guestActivatedDocPath(rest[0]) };
      return null;

    case "guestanswered":
      if (rest.length === 1) return { path: guestAnsweredDocPath(rest[0]) };
      return null;

    case "saleswithin7d":
      if (rest.length === 1) return { path: salesWithin7dDocPath(rest[0]) };
      return null;

    case "injectionhistory":
      if (rest.length === 2) {
        return { path: injectionHistoryDocPath(injectionHistoryDocId(rest[0], rest[1])) };
      }
      return null;

    case "lead_pointer":
    case "leadpointer":
      if (rest.length === 1) return { path: leadPointerDocPath(rest[0]) };
      return null;

    case "lead_history":
    case "orchestratorevents":
      if (rest.length === 2) {
        return { path: orchestratorEventDocPath(orchestratorEventDocId(rest[0], rest[1])) };
      }
      return null;

    case "rate_limit":
    case "ratelimit":
      // legacy: ["rate_limit", "30d", phone] → use phone segment
      if (rest.length >= 1) {
        return { path: rateLimitDocPath(rest[rest.length - 1]) };
      }
      return null;

    case "global_sms_count":
    case "globalsmscount":
      if (rest.length === 1) return { path: globalSmsCountDocPath(rest[0]) };
      return null;

    case "ab_variant_current":
    case "sms_ab_toggle":
    case "abtest":
      if (rest.length === 0) {
        return {
          path: `${ROOT_COLLECTION}/config/settings/ab-toggle`,
        };
      }
      if (rest.length === 1) return { path: abTestDocPath(rest[0]) };
      return null;

    case "config":
      // ["config", "state"] → settings/state
      if (rest.length === 1) {
        return { path: `${ROOT_COLLECTION}/config/settings/${rest[0]}` };
      }
      return null;

    case "conversations":
      // ["conversations", phone, callId, timestamp] → deterministic doc id
      if (rest.length === 3) {
        return { path: conversationDocPath(conversationDocId(rest[0], rest[1], rest[2])) };
      }
      return null;

    case "lookup_call_id":
      if (rest.length === 1) return { path: lookupDocPath(rest[0]) };
      return null;

    default:
      return null;
  }
}

export function legacyKeyToCollectionPath(prefix: LegacyKey): LegacyCollectionPath | null {
  if (!Array.isArray(prefix) || prefix.length === 0) return null;
  const head = String(prefix[0]);
  const rest = prefix.slice(1).map(String);

  switch (head) {
    case "audit":
      return { parent: `${ROOT_COLLECTION}/audit/byRecordId` };
    case "auditstage":
      if (rest.length >= 1) {
        return { parent: `${ROOT_COLLECTION}/auditstage/${rest[0]}` };
      }
      return null;
    case "scheduledinjection":
      return { parent: `${ROOT_COLLECTION}/scheduledinjections/byPhone` };
    case "smsflowcontext":
    case "sms_flow_context":
      return { parent: `${ROOT_COLLECTION}/smsflowcontext/byPhone` };
    case "guestactivated":
      return { parent: `${ROOT_COLLECTION}/guestactivated/byPhone` };
    case "guestanswered":
      return { parent: `${ROOT_COLLECTION}/guestanswered/byPhone` };
    case "saleswithin7d":
      return { parent: `${ROOT_COLLECTION}/saleswithin7d/byPhone` };
    case "injectionhistory":
      if (rest.length >= 1) {
        const phone = rest[0];
        return {
          parent: `${ROOT_COLLECTION}/injectionhistory/byPhone`,
          filterFn: (id: string) => id.startsWith(`${phone}__`),
        };
      }
      return { parent: `${ROOT_COLLECTION}/injectionhistory/byPhone` };
    case "lead_pointer":
    case "leadpointer":
      return { parent: `${ROOT_COLLECTION}/leadpointer/byPhone` };
    case "lead_history":
    case "orchestratorevents":
      if (rest.length >= 1) {
        const phone = rest[0];
        return {
          parent: `${ROOT_COLLECTION}/orchestratorevents/byPhone`,
          filterFn: (id: string) => id.startsWith(`${phone}__`),
        };
      }
      return { parent: `${ROOT_COLLECTION}/orchestratorevents/byPhone` };
    case "global_sms_count":
    case "globalsmscount":
      return { parent: `${ROOT_COLLECTION}/globalsmscount/byDate` };
    case "conversations":
      if (rest.length >= 1) {
        const phone = rest[0];
        const callIdPart = rest[1];
        return {
          parent: `${ROOT_COLLECTION}/conversations/messages`,
          filterFn: callIdPart
            ? (id: string) => id.startsWith(`${phone}__${callIdPart}__`)
            : (id: string) => id.startsWith(`${phone}__`),
        };
      }
      return { parent: `${ROOT_COLLECTION}/conversations/messages` };
    case "lookup_call_id":
      return { parent: `${ROOT_COLLECTION}/conversations/byCallId` };
    case "abtest":
      return { parent: `${ROOT_COLLECTION}/abtest/byPhone` };
    default:
      return null;
  }
}

// Reverse: given a Firestore doc id and the prefix it was listed under, build
// a synthetic legacy key for response payloads. Used by /api/kv/list to keep
// the legacy `entries: [{key, value}]` shape working for old callers.
export function reconstructLegacyKey(
  prefix: LegacyKey,
  docId: string,
): LegacyKey {
  return [...prefix.map(String), docId];
}
