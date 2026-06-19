export interface AuditMarker {
  processedAt: string;
  source: string;
  stage: string | null;
  meta?: Record<string, unknown>;
}

export interface AuditSaveResult {
  success: true;
  recordId: string;
  stage?: string | null;
  path: string;
  created?: boolean;
  existed?: boolean;
  overridden?: boolean;
  timestamp?: string | null;
  existingValue?: unknown;
}

export interface AuditCheckResult {
  exists: boolean;
  recordId: string;
  stage: string | null;
  path: string;
  timestamp: string | null;
  value: unknown;
}
