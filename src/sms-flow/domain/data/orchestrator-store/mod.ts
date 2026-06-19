// Lead pointer + event log. Replaces the legacy KV-backed
// LeadOrchestratorService with Firestore.

import {
  leadPointerDocPath,
  orchestratorEventDocPath,
  orchestratorEventsCollection,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type {
  LeadPointer,
  OrchestratorAction,
  OrchestratorEvent,
} from "@shared/types/orchestrator.ts";
import type { DialerDomain } from "@shared/types/readymode.ts";
import { orchestratorEventDocId } from "@shared/util/id.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export async function updatePointer(
  rawPhone: string,
  update: Partial<LeadPointer>,
  client: FirestoreClient = getFirestoreClient(),
): Promise<LeadPointer> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  const path = leadPointerDocPath(phone);
  // Read-then-write inside a transaction so concurrent disposition +
  // appt-booked webhooks for the same phone don't lose each other's
  // updates (one would otherwise overwrite the other's field values).
  const next = await client.transactionalUpdate(path, (existing) => {
    const prev = existing as LeadPointer | null;
    const merged: LeadPointer = {
      phone,
      currentLocation: prev?.currentLocation ?? null,
      originalSource: prev?.originalSource ?? null,
      status: prev?.status ?? "SCRUBBED",
      lastAction: prev?.lastAction ?? "INIT",
      ...update,
    };
    return merged as unknown as Record<string, unknown>;
  });
  return next as unknown as LeadPointer;
}

export async function logEvent(
  rawPhone: string,
  event: {
    action: OrchestratorAction;
    domain: DialerDomain;
    campaignId?: string;
    details?: string;
  },
  client: FirestoreClient = getFirestoreClient(),
): Promise<void> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  // Mirror `phone` as a doc field so getEvents can use where(phone == ...)
  // instead of listing the whole collection and filtering by doc-ID prefix.
  const entry: OrchestratorEvent = { ...event, phone, timestamp: Date.now() };
  const docId = orchestratorEventDocId(phone, String(entry.timestamp));
  await client.set(
    orchestratorEventDocPath(docId),
    entry as unknown as Record<string, unknown>,
  );
}

export async function getPointer(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<LeadPointer | null> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  return await client.get(leadPointerDocPath(phone)) as LeadPointer | null;
}

export async function getEvents(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<OrchestratorEvent[]> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  // Filter at the database via the `phone` field on each doc. Historical
  // docs predating the field need scripts/backfill-orchestrator-phone.ts.
  const matches = await client.list(orchestratorEventsCollection, {
    where: { field: "phone", op: "==", value: phone },
  });
  return matches
    .map((e) => e.data as unknown as OrchestratorEvent)
    .sort((a, b) => b.timestamp - a.timestamp);
}
