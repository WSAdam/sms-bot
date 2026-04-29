// Audit dedupe. Mirrors the legacy main.ts saveAuditMarker / checkAuditMarker
// semantics: claim mode uses atomicCreate; override mode unconditionally
// writes; default mode writes legacy + landing-stage keys.
//
// Stage handling: when stage is provided, the doc lives under
// sms-bot/auditstage/{stage}/{recordId}. When stage is null, the legacy global
// path sms-bot/audit/byRecordId/{recordId} is used. For backward-compat with
// dashboards that count legacy keys, we ALSO mirror writes into the landing
// stage when appropriate.

import {
  auditDocPath,
  auditStageDocPath,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import { claim } from "@shared/firestore/txn.ts";
import type {
  AuditCheckResult,
  AuditMarker,
  AuditSaveResult,
} from "@shared/types/audit.ts";

export function sanitizeStage(stage: unknown): string | null {
  if (typeof stage !== "string") return null;
  const s = stage.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9-]{1,32}$/.test(s)) return null;
  return s;
}

export interface SaveOpts {
  recordId: string;
  stage?: string | null;
  source?: string;
  claim?: boolean;
  override?: boolean;
  meta?: Record<string, unknown>;
  client?: FirestoreClient;
}

export async function saveAuditMarker(opts: SaveOpts): Promise<AuditSaveResult> {
  const client = opts.client ?? getFirestoreClient();
  const recordId = String(opts.recordId);
  const stage = sanitizeStage(opts.stage) ?? null;
  const claimMode = !!opts.claim;
  const override = !!opts.override;
  const processedAt = new Date().toISOString();

  const value: AuditMarker = {
    processedAt,
    source: opts.source ?? "AuditController",
    stage,
    meta: opts.meta,
  };

  const targetPath = stage ? auditStageDocPath(stage, recordId) : auditDocPath(recordId);

  if (override) {
    await client.set(targetPath, value as unknown as Record<string, unknown>);
    if (!stage || stage === "landing") {
      await client.set(
        auditStageDocPath("landing", recordId),
        { ...value, stage: "landing" } as unknown as Record<string, unknown>,
      );
    }
    if (stage === "landing") {
      await client.set(
        auditDocPath(recordId),
        { ...value, stage: "landing" } as unknown as Record<string, unknown>,
      );
    }
    return {
      success: true,
      recordId,
      stage,
      path: targetPath,
      created: true,
      existed: false,
      overridden: true,
      timestamp: processedAt,
    };
  }

  if (claimMode) {
    const r = await claim(targetPath, value as unknown as Record<string, unknown>, client);
    if (r.created && (!stage || stage === "landing")) {
      await client.set(
        auditStageDocPath("landing", recordId),
        { ...value, stage: "landing" } as unknown as Record<string, unknown>,
      );
    }
    if (r.created && stage === "landing") {
      await client.set(
        auditDocPath(recordId),
        { ...value, stage: "landing" } as unknown as Record<string, unknown>,
      );
    }
    return {
      success: true,
      recordId,
      stage,
      path: targetPath,
      created: r.created,
      existed: !r.created,
      overridden: false,
      timestamp: r.created ? processedAt : r.timestamp,
      existingValue: r.created ? null : r.existing,
    };
  }

  // Default: write target + legacy landing mirror.
  await client.set(targetPath, value as unknown as Record<string, unknown>);
  if (!stage) {
    await client.set(
      auditStageDocPath("landing", recordId),
      { ...value, stage: "landing" } as unknown as Record<string, unknown>,
    );
  } else if (stage === "landing") {
    await client.set(
      auditDocPath(recordId),
      { ...value, stage: "landing" } as unknown as Record<string, unknown>,
    );
  }
  return {
    success: true,
    recordId,
    stage,
    path: targetPath,
    created: true,
    existed: false,
    overridden: false,
    timestamp: processedAt,
  };
}

export async function checkAuditMarker(opts: {
  recordId: string;
  stage?: string | null;
  client?: FirestoreClient;
}): Promise<AuditCheckResult> {
  const client = opts.client ?? getFirestoreClient();
  const recordId = String(opts.recordId);
  const stage = sanitizeStage(opts.stage) ?? null;
  const path = stage ? auditStageDocPath(stage, recordId) : auditDocPath(recordId);
  const value = await client.get(path);
  const exists = value != null;
  const ts = value && typeof value === "object"
    ? (value as Record<string, unknown>).processedAt as string ?? null
    : null;
  return { exists, recordId, stage, path, timestamp: ts, value };
}
