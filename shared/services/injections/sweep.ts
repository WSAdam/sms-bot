// Cron sweep: find scheduled injections whose eventTime <= now, fire each by
// calling the queue/trigger handler logic, write history, delete the
// scheduled doc.

import {
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type {
  FutureInjection,
  InjectionHistoryEntry,
} from "@shared/types/injection.ts";
import { injectionHistoryDocId } from "@shared/util/id.ts";
import { handleDelayedInjection } from "@shared/services/orchestrator/queue.ts";

export interface SweepResult {
  scanned: number;
  fired: number;
  errors: Array<{ phone: string; error: string }>;
}

export async function sweepScheduledInjections(
  firedBy: "cron" | "manual" = "cron",
  client: FirestoreClient = getFirestoreClient(),
): Promise<SweepResult> {
  const all = await client.list(scheduledInjectionsCollection, { limit: 500 });
  const now = Date.now();
  const due: Array<{ phone: string; injection: FutureInjection }> = [];

  for (const e of all) {
    const inj = e.data as unknown as FutureInjection;
    const eventMs = new Date(inj.eventTime).getTime();
    if (Number.isFinite(eventMs) && eventMs <= now) {
      due.push({ phone: e.id, injection: inj });
    }
  }

  const errors: SweepResult["errors"] = [];
  let fired = 0;

  for (const { phone, injection } of due) {
    const firedAt = new Date().toISOString();
    let status: InjectionHistoryEntry["status"] = "success";
    let errorMsg: string | undefined;

    try {
      await handleDelayedInjection(phone);
      fired++;
    } catch (e) {
      status = "error";
      errorMsg = (e as Error).message;
      errors.push({ phone, error: errorMsg });
    }

    const history: InjectionHistoryEntry = {
      phone,
      eventTime: injection.eventTime,
      scheduledAt: injection.scheduledAt,
      firedAt,
      firedBy,
      status,
      ...(injection.isTest ? { isTest: true } : {}),
      ...(errorMsg ? { error: errorMsg } : {}),
    };

    await client.set(
      injectionHistoryDocPath(injectionHistoryDocId(phone, firedAt)),
      history as unknown as Record<string, unknown>,
    );
    await client.delete(scheduledInjectionDocPath(phone));
  }

  return { scanned: all.length, fired, errors };
}

export async function fireSingle(
  phone: string,
  firedBy: "cron" | "manual" = "manual",
  client: FirestoreClient = getFirestoreClient(),
): Promise<{ fired: boolean; error?: string }> {
  const inj = await client.get(scheduledInjectionDocPath(phone)) as
    | FutureInjection
    | null;
  if (!inj) return { fired: false, error: "not scheduled" };

  const firedAt = new Date().toISOString();
  let status: InjectionHistoryEntry["status"] = "success";
  let errorMsg: string | undefined;
  try {
    await handleDelayedInjection(phone);
  } catch (e) {
    status = "error";
    errorMsg = (e as Error).message;
  }

  const history: InjectionHistoryEntry = {
    phone,
    eventTime: inj.eventTime,
    scheduledAt: inj.scheduledAt,
    firedAt,
    firedBy,
    status,
    ...(inj.isTest ? { isTest: true } : {}),
    ...(errorMsg ? { error: errorMsg } : {}),
  };

  await client.set(
    injectionHistoryDocPath(injectionHistoryDocId(phone, firedAt)),
    history as unknown as Record<string, unknown>,
  );
  await client.delete(scheduledInjectionDocPath(phone));
  return { fired: status === "success", error: errorMsg };
}
