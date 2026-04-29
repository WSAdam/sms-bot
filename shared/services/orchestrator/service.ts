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
  const existing = (await client.get(path)) as LeadPointer | null;
  const next: LeadPointer = {
    phone,
    currentLocation: existing?.currentLocation ?? null,
    originalSource: existing?.originalSource ?? null,
    status: existing?.status ?? "SCRUBBED",
    lastAction: existing?.lastAction ?? "INIT",
    ...update,
  };
  await client.set(path, next as unknown as Record<string, unknown>);
  return next;
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
  const entry: OrchestratorEvent = { ...event, timestamp: Date.now() };
  const docId = orchestratorEventDocId(phone, String(entry.timestamp));
  await client.set(orchestratorEventDocPath(docId), entry as unknown as Record<string, unknown>);
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
  // Event docIds are `${phone10}__${timestamp}` — list and filter client-side.
  const all = await client.list(orchestratorEventsCollection, { limit: 500 });
  return all
    .filter((e) => e.id.startsWith(`${phone}__`))
    .map((e) => e.data as unknown as OrchestratorEvent)
    .sort((a, b) => b.timestamp - a.timestamp);
}
