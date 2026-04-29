// main.ts
// GOOGLE SHEETS KV SERVICE
// Drop-in version with startup processor call removed.
// Scheduled injection processing now runs ONLY when /api/cron/trigger is poked (POST/GET).
//
// Improvements in this version:
// - Audit browse server-side pagination optional stage browsing.
// - Conversation search adds /api/conversations/search2 with filters phone optional callId sender nodeTag contains limit.
// - UI theme dark greens + silvers via shared CSS variables across pages (replaces blue accents).
//
// Upgrade in this version:
// - Dashboard: Click Appointments heuristic to open an overlay showing only appointment-matching entries for the currently selected date range/prefix filter.
//
// NEW in this drop-in:
// - Adds a default home route GET / (only when no legacy query params are present) that renders a simple landing page with buttons to the other UI features.
//
// NEWEST in this drop-in:
// - POST /api/guests/activate — receives SHA-256 hashes of 10-digit phones, compares to scheduledinjection entries from past 7 days, writes ["guestactivated", phone10] with Activated: true
// - POST /api/guests/answered — receives plain 10-digit phone, writes ["guestanswered", phone10] with answered: true
// - Dashboard stats now counts guestactivated and guestanswered entries and displays Activated + Answered stat cards

import { ServerClient } from "npm:postmark";

const kv = await Deno.openKv();

// -----------------------------
// Small utilities
// -----------------------------
function parseBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}

function clampInt(
  v: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof v === "string"
    ? Number.parseInt(v, 10)
    : typeof v === "number"
    ? v
    : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function normalizePhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const phone = v.replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) return null;
  return phone;
}

function sanitizeStage(stage: unknown): string | null {
  if (typeof stage !== "string") return null;
  const s = stage.trim().toLowerCase();
  if (!s) return null;
  // Keep it KV-key-safe and predictable
  if (!/^[a-z0-9-]{1,32}$/.test(s)) return null;
  return s;
}

function safeLower(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase() : "";
}

// -----------------------------
// Appointment heuristic
// -----------------------------
const appointmentKeywords = ["appointment scheduled"];

function isAppointmentMatch(msg: any): boolean {
  const nodeTag = safeLower(msg?.nodeTag);
  if (!nodeTag) return false;
  return appointmentKeywords.some((kw) => nodeTag.includes(kw));
}

function withinOptionalDateRange(
  iso: string | null,
  startDate: Date | null,
  endDate: Date | null,
): boolean {
  if (!iso) return false;
  if (!startDate && !endDate) return true;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}

// -----------------------------
// Sale/appointment helpers (additive)
// -----------------------------
function normalizePhone11To10(
  v: unknown,
): { phone11: string; phone10: string } | null {
  if (typeof v !== "string") return null;
  const digits = v.replace(/\D/g, "");
  if (digits.length !== 11) return null;
  if (!digits.startsWith("1")) return null;
  const phone10 = digits.slice(-10);
  if (phone10.length !== 10) return null;
  return { phone11: digits, phone10 };
}

function parseDateishToMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const d = new Date(v);
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

type SaleWithinWindowMarker = {
  phone10: string;
  phone11: string;
  appointmentAt: string;
  saleAt: string;
  windowDays: number;
  withinDays: number;
  updatedAt: string;
  meta?: any;
};

function appointmentKey(phone10: string): Deno.KvKey {
  // WIRED: appointments live at scheduledinjection per your logs + existing schedule endpoint
  return ["scheduledinjection", phone10];
}

function saleMarkerKey(phone10: string): Deno.KvKey {
  // Marker stored at ["saleswithin7d", phone10]
  return ["saleswithin7d", phone10];
}

function guestActivatedKey(phone10: string): Deno.KvKey {
  return ["guestactivated", phone10];
}

function guestAnsweredKey(phone10: string): Deno.KvKey {
  return ["guestanswered", phone10];
}

async function getAppointmentAtForPhone(phone10: string): Promise<
  { found: boolean; appointmentAt: string | null; raw: any | null }
> {
  const res = await kv.get(appointmentKey(phone10));
  if (!res.value) return { found: false, appointmentAt: null, raw: null };
  const v: any = res.value;

  // WIRED: scheduledinjection stores eventTime as the appointment time
  const appointmentAt = typeof v?.eventTime === "string"
    ? v.eventTime
    : typeof v?.appointmentAt === "string"
    ? v.appointmentAt
    : typeof v?.scheduledAt === "string"
    ? v.scheduledAt
    : typeof v?.timestamp === "string"
    ? v.timestamp
    : null;

  if (!appointmentAt) return { found: false, appointmentAt: null, raw: v };
  return { found: true, appointmentAt, raw: v };
}

function isWithinWindowAfter(
  appointmentAtMs: number,
  saleAtMs: number,
  windowDays: number,
): boolean {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  if (saleAtMs < appointmentAtMs) return false;
  return (saleAtMs - appointmentAtMs) <= windowMs;
}

// -----------------------------
// SHA-256 helper (Web Crypto)
// -----------------------------
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// -----------------------------
// Audit dedupe enhancements (Landing/Live + atomic claim)
// -----------------------------
function auditKey(recordId: string): Deno.KvKey {
  return ["audit", recordId];
}

function auditStageKey(stage: string, recordId: string): Deno.KvKey {
  return ["auditstage", stage, recordId];
}

type AuditSaveResult = {
  success: true;
  recordId: string;
  stage?: string | null;
  key: Deno.KvKey;
  created?: boolean;
  existed?: boolean;
  overridden?: boolean;
  timestamp?: string | null;
  existingValue?: unknown;
};

async function atomicClaimKey(
  key: Deno.KvKey,
  value: unknown,
): Promise<{ created: boolean; existingValue: unknown | null }> {
  const commit = await kv.atomic()
    .check({ key, versionstamp: null })
    .set(key, value)
    .commit();

  if (commit.ok) return { created: true, existingValue: null };

  const existing = await kv.get(key);
  return { created: false, existingValue: existing.value ?? null };
}

async function saveAuditMarker(opts: {
  recordId: string;
  stage?: string | null;
  source?: string;
  claim?: boolean;
  override?: boolean;
  meta?: any;
}): Promise<AuditSaveResult> {
  const recordId = String(opts.recordId);
  const stage = sanitizeStage(opts.stage) ?? null;
  const claim = !!opts.claim;
  const override = !!opts.override;
  const processedAt = new Date().toISOString();

  const value = {
    processedAt,
    source: opts.source ?? "AuditController",
    stage: stage ?? null,
    meta: opts.meta ?? undefined,
  };

  // Determine target key:
  // - If stage is provided -> stage key
  // - Else -> legacy/global key
  const targetKey = stage ? auditStageKey(stage, recordId) : auditKey(recordId);

  // Override always write (no dedupe)
  if (override) {
    await kv.set(targetKey, value);

    // Extra injection:
    // - If this is the legacy/global save (no stage) OR stage=landing,
    //   also ensure landing stage key exists
    if (!stage || stage === "landing") {
      await kv.set(auditStageKey("landing", recordId), {
        ...value,
        stage: "landing",
      });
    }

    // And keep legacy/global key in sync for stage=landing
    if (stage === "landing") {
      await kv.set(auditKey(recordId), { ...value, stage: "landing" });
    }

    return {
      success: true,
      recordId,
      stage,
      key: targetKey,
      created: true,
      existed: false,
      overridden: true,
      timestamp: processedAt,
    };
  }

  // Claim mode atomic insert-if-absent
  if (claim) {
    const { created, existingValue } = await atomicClaimKey(targetKey, value);

    // Extra injection:
    // - If this is the legacy/global claim (no stage) OR stage=landing,
    //   also ensure landing stage key exists
    // NOTE: For landing, the legacy/global key is the one older code checks, so we keep them consistent.
    if (!stage || stage === "landing") {
      if (created && !stage) {
        await kv.atomic()
          .set(auditStageKey("landing", recordId), {
            ...value,
            stage: "landing",
          })
          .commit();
      }
    }

    // If caller explicitly used stage=landing, keep legacy/global key as well
    if (stage === "landing" && created) {
      await kv.atomic()
        .set(auditKey(recordId), { ...value, stage: "landing" })
        .commit();
    }

    const existingTs = (existingValue && typeof existingValue === "object" &&
        (existingValue as any).processedAt)
      ? (existingValue as any).processedAt
      : null;

    return {
      success: true,
      recordId,
      stage,
      key: targetKey,
      created,
      existed: !created,
      overridden: false,
      timestamp: created ? processedAt : existingTs,
      existingValue: created ? null : existingValue,
    };
  }

  // Default behavior: always write legacy semantics, but also inject landing stage marker
  await kv.set(targetKey, value);

  if (!stage) {
    // Legacy/global save: also create landing stage marker (extra key injection requested)
    await kv.set(auditStageKey("landing", recordId), {
      ...value,
      stage: "landing",
    });
  } else if (stage === "landing") {
    // If caller explicitly sets landing stage, keep legacy key too for backward compatibility
    await kv.set(auditKey(recordId), { ...value, stage: "landing" });
  }

  return {
    success: true,
    recordId,
    stage,
    key: targetKey,
    created: true,
    existed: false,
    overridden: false,
    timestamp: processedAt,
  };
}

async function checkAuditMarker(opts: {
  recordId: string;
  stage?: string | null;
}): Promise<
  {
    exists: boolean;
    recordId: string;
    stage: string | null;
    key: Deno.KvKey;
    timestamp: string | null;
    value: unknown;
  }
> {
  const recordId = String(opts.recordId);
  const stage = sanitizeStage(opts.stage) ?? null;
  const key = stage ? auditStageKey(stage, recordId) : auditKey(recordId);
  const result = await kv.get(key);
  const exists = result.value != null;
  const ts = result.value && typeof result.value === "object"
    ? (result.value as any).processedAt ?? null
    : null;

  return {
    exists,
    recordId,
    stage,
    key,
    timestamp: ts,
    value: result.value ?? null,
  };
}

// -----------------------------
// Shared UI theme (dark greens + silver)
// -----------------------------
const sharedThemeCss = `
:root{
  --bg:#0b1210;
  --panel:#0f1b17;
  --panel2:#10221c;
  --panel3:#132a23;
  --border:#2a3b36;
  --text:#d7dde0;
  --muted:#98a6ad;
  --muted2:#7f8b91;
  --silver:#c3ccd1;
  --accent:#19c37d;
  --accent2:#0ea86b;
  --accentHi:#27e39a;
  --danger:#ff4757;
  --warning:#ff9f43;
  --shadow:0 10px 30px rgba(0,0,0,.35);
  box-sizing:border-box;
}
*{box-sizing:inherit;margin:0;padding:0}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:
    radial-gradient(1200px 700px at 20% 0%, rgba(25,195,125,.12), transparent 60%),
    radial-gradient(900px 600px at 80% 30%, rgba(195,204,209,.08), transparent 55%),
    var(--bg);
  color:var(--text);
  min-height:100vh;
  padding:20px;
}
.container{max-width:1200px;margin:0 auto}
h1{text-align:center;margin-bottom:10px;color:var(--silver);font-size:2rem;letter-spacing:.2px}
.subtitle{text-align:center;color:var(--muted2);margin-bottom:30px}
.nav-links{text-align:center;margin-bottom:30px}
.nav-links a{
  color:var(--accent);
  text-decoration:none;
  margin:0 10px;
  padding:8px 16px;
  border:1px solid rgba(25,195,125,.45);
  border-radius:8px;
  transition:all .18s ease;
  display:inline-block;
  margin-bottom:10px;
  background:rgba(15,27,23,.35);
  backdrop-filter:blur(4px);
}
.nav-links a:hover{
  background:rgba(25,195,125,.16);
  border-color:rgba(25,195,125,.75);
  color:var(--accentHi);
  transform:translateY(-1px);
}
.panel{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  padding:20px;
  box-shadow:var(--shadow);
}
.filters{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end}
.filter-group{display:flex;flex-direction:column;gap:6px}
.filter-group label{font-size:.85rem;color:var(--muted)}
input[type="text"], input[type="date"], select{
  padding:10px 14px;
  font-size:1rem;
  border:1px solid rgba(42,59,54,.95);
  border-radius:10px;
  background:rgba(11,18,16,.75);
  color:var(--text);
  outline:none;
  transition:border-color .18s ease, box-shadow .18s ease;
}
input[type="text"]:focus, input[type="date"]:focus, select:focus{
  border-color:rgba(25,195,125,.95);
  box-shadow:0 0 0 3px rgba(25,195,125,.18);
}
input::placeholder{color:rgba(152,166,173,.75)}
button{
  padding:10px 22px;
  font-size:1rem;
  background:linear-gradient(180deg, var(--accentHi), var(--accent));
  color:#08110e;
  border:none;
  border-radius:10px;
  cursor:pointer;
  font-weight:700;
  transition:transform .1s ease, filter .15s ease, opacity .15s ease;
  height:42px;
}
button:hover{filter:brightness(1.02);transform:translateY(-1px)}
button:disabled{opacity:.45;cursor:not-allowed;transform:none}
button.secondary{
  background:transparent;
  border:1px solid rgba(195,204,209,.35);
  color:var(--silver);
}
button.secondary:hover{
  background:rgba(195,204,209,.10);
  border-color:rgba(195,204,209,.55);
  color:#e7eef2;
}
.table{width:100%;border-collapse:collapse;margin-top:10px}
.table th,.table td{padding:12px 15px;text-align:left;border-bottom:1px solid rgba(42,59,54,.9)}
.table th{color:var(--muted);font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em}
.table tr:hover{background:rgba(25,195,125,.06)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace}
.badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:.78rem;font-weight:800;letter-spacing:.02em}
.badge.danger{background:rgba(255,71,87,.18);color:#ffd1d7;border:1px solid rgba(255,71,87,.35)}
.badge.ok{background:rgba(25,195,125,.16);color:#b8ffe2;border:1px solid rgba(25,195,125,.35)}
.loading{text-align:center;padding:60px;color:var(--muted)}
.spinner{width:50px;height:50px;border:4px solid rgba(42,59,54,.85);border-top-color:rgba(25,195,125,.95);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 18px}
@keyframes spin{to{transform:rotate(360deg)}}
.error{background:rgba(255,71,87,.18);border:1px solid rgba(255,71,87,.35);color:#ffd1d7;padding:14px 16px;border-radius:12px;margin-bottom:16px}
.muted{color:var(--muted)}
`;

// -----------------------------
// Home/Landing HTML (GET / when no legacy query params)
// -----------------------------
const homePageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Google Sheets KV - Home</title>
<style>
${sharedThemeCss}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:14px}
.card{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:14px;
  padding:18px;
  box-shadow:var(--shadow);
}
.card h2{color:var(--silver);font-size:1.05rem;margin-bottom:6px}
.card p{color:var(--muted);line-height:1.45;margin-bottom:12px}
.actions{display:flex;gap:10px;flex-wrap:wrap}
a.btn{
  display:inline-block;
  padding:10px 16px;
  border-radius:10px;
  text-decoration:none;
  font-weight:800;
  border:1px solid rgba(25,195,125,.45);
  background:rgba(25,195,125,.10);
  color:var(--accentHi);
  transition:all .18s ease;
}
a.btn:hover{background:rgba(25,195,125,.16);transform:translateY(-1px);border-color:rgba(25,195,125,.75)}
a.btn.secondary{
  border-color:rgba(195,204,209,.35);
  color:var(--silver);
  background:rgba(195,204,209,.06);
}
a.btn.secondary:hover{background:rgba(195,204,209,.10);border-color:rgba(195,204,209,.55)}
.small{font-size:.85rem}
hr{border:none;border-top:1px solid rgba(42,59,54,.75);margin:18px 0}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;color:var(--muted2)}
</style>
</head>
<body>
  <div class="container">
    <h1>Google Sheets KV Service</h1>
    <p class="subtitle">Pick a UI page below (or hit an API endpoint directly).</p>

    <div class="panel">
      <div class="nav-links">
        <a href="/dashboard">Dashboard</a>
        <a href="/search">Conversation Search</a>
        <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
      </div>

      <div class="grid">
        <div class="card">
          <h2>SMS Analytics Dashboard</h2>
          <p>Stats + KV breakdown + recent activity, with an appointments drill-in overlay.</p>
          <div class="actions">
            <a class="btn" href="/dashboard">Open Dashboard</a>
            <a class="btn secondary" href="/api/dashboard/stats">API: /api/dashboard/stats</a>
          </div>
        </div>

        <div class="card">
          <h2>Conversation Search</h2>
          <p>Search conversations by phone, with optional filters (callId/sender/nodeTag/message contains).</p>
          <div class="actions">
            <a class="btn" href="/search">Open Search</a>
            <a class="btn secondary" href="/api/conversations/search?phone=5551234567">API: legacy search</a>
          </div>
          <p class="small muted" style="margin-top:10px">
            Tip: improved endpoint is <span class="code">/api/conversations/search2</span>.
          </p>
        </div>

        <div class="card">
          <h2>Audit Record Search</h2>
          <p>Lookup a record ID quickly or browse paged results (optional stage browsing).</p>
          <div class="actions">
            <a class="btn" href="/audit">Open Audit</a>
            <a class="btn secondary" href="/api/audit/browse">API: /api/audit/browse</a>
          </div>
        </div>

        <div class="card">
          <h2>Cron Trigger</h2>
          <p>Manually run scheduled injection processing (external cron mode).</p>
          <div class="actions">
            <a class="btn" href="/api/cron/trigger">GET /api/cron/trigger</a>
            <a class="btn secondary" href="/api/state">GET /api/state</a>
          </div>
        </div>

        <div class="card">
          <h2>Guest Endpoints</h2>
          <p>POST /api/guests/activate (bulk SHA phone matching) and POST /api/guests/answered (mark answered).</p>
          <div class="actions">
            <a class="btn secondary" href="#">POST /api/guests/activate</a>
            <a class="btn secondary" href="#">POST /api/guests/answered</a>
          </div>
        </div>

        <div class="card">
          <h2>Nightly Report</h2>
          <p>Send a daily summary email with dashboard stats + conversations CSV via Postmark.</p>
          <div class="actions">
            <a class="btn" href="/api/report/nightly">GET /api/report/nightly</a>
          </div>
          <p class="small muted" style="margin-top:10px">
            Requires env var: <span class="code">POSTMARK_SERVER</span>. Sends to adamp@monsterrg.com. Optional: <span class="code">?date=YYYY-MM-DD</span>
          </p>
        </div>
      </div>

      <hr />
      <p class="muted small">
        This page handles <span class="code">GET /</span> when there is no legacy <span class="code">recordId</span> query param.
      </p>
    </div>
  </div>
</body>
</html>`;

// -----------------------------
// Audit Search HTML
// -----------------------------
const auditSearchHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Audit Search</title>
<style>
${sharedThemeCss}
.stats-bar{display:flex;gap:40px;flex-wrap:wrap;margin-bottom:16px}
.stat-item{text-align:center;min-width:140px}
.stat-item .value{font-size:2rem;font-weight:900;color:var(--silver)}
.stat-item .label{font-size:.85rem;color:var(--muted)}
.results-section{margin-top:16px}
.pagination{display:flex;justify-content:center;gap:10px;margin-top:14px;align-items:center}
</style>
</head>
<body>
<div class="container">
  <h1>Audit Record Search</h1>
  <p class="subtitle">Search and browse deduplication audit records.</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
  </div>

  <div class="panel" style="margin-bottom:16px">
    <h3 style="color:var(--silver); margin-bottom:12px">Quick Lookup</h3>
    <div class="filters">
      <div class="filter-group" style="flex:1">
        <label>Record ID</label>
        <input type="text" id="singleRecordId" placeholder="Enter record ID to check..." />
      </div>
      <div class="filter-group">
        <label>Stage (optional)</label>
        <input type="text" id="singleStage" placeholder="e.g. landing, live" />
      </div>
      <button onclick="checkSingleRecord()">Check</button>
    </div>
    <div id="singleResult" style="display:none; margin-top:12px" class="panel"></div>
  </div>

  <div class="panel" style="margin-bottom:16px">
    <div class="filters">
      <div class="filter-group">
        <label>Start Date</label>
        <input type="date" id="startDate" />
      </div>
      <div class="filter-group">
        <label>End Date</label>
        <input type="date" id="endDate" />
      </div>
      <div class="filter-group">
        <label>Stage (optional)</label>
        <input type="text" id="stage" placeholder="(blank = legacy audit)" />
      </div>
      <div class="filter-group" style="flex:1">
        <label>Record ID contains</label>
        <input type="text" id="searchRecordId" placeholder="Filter by ID..." />
      </div>
      <button onclick="loadAuditData()">Search</button>
      <button class="secondary" onclick="resetFilters()">Reset</button>
    </div>
    <p class="muted" style="margin-top:10px">
      Tip: Stage browsing uses stage keys <span class="mono">auditstage</span>. Leaving Stage empty searches legacy <span class="mono">audit</span> keys.
    </p>
  </div>

  <div id="loading" class="loading" style="display:none">
    <div class="spinner"></div>
    <p>Loading audit data...</p>
  </div>
  <div id="error" class="error" style="display:none"></div>

  <div id="content">
    <div class="panel" style="margin-bottom:16px">
      <div class="stats-bar">
        <div class="stat-item">
          <div class="value" id="totalRecords">-</div>
          <div class="label">Total (filtered)</div>
        </div>
        <div class="stat-item">
          <div class="value" id="todayRecords">-</div>
          <div class="label">Today (filtered)</div>
        </div>
        <div class="stat-item">
          <div class="value" id="latestDate">-</div>
          <div class="label">Latest</div>
        </div>
      </div>
    </div>

    <div class="panel results-section">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap">
        <h2 style="color:var(--silver); font-size:1.25rem">Audit Records</h2>
        <span id="resultsInfo" class="muted"></span>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>Record ID</th>
            <th>Processed At</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody id="auditResults"></tbody>
      </table>

      <div id="emptyState" class="muted" style="display:none; text-align:center; padding:28px">
        No audit records found matching your filters.
      </div>

      <div class="pagination" id="pagination"></div>
    </div>
  </div>
</div>

<script>
let currentPage = 1;
let pageSize = 50;
let totalRecords = 0;

// Default dates: today
const today = new Date();
document.getElementById("endDate").value = today.toISOString().split("T")[0];
document.getElementById("startDate").value = today.toISOString().split("T")[0];

document.getElementById("singleRecordId").addEventListener("keypress", (e) => {
  if (e.key === "Enter") checkSingleRecord();
});
document.getElementById("searchRecordId").addEventListener("keypress", (e) => {
  if (e.key === "Enter") loadAuditData();
});

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

async function checkSingleRecord(){
  const recordId = document.getElementById("singleRecordId").value.trim();
  const stage = document.getElementById("singleStage").value.trim();
  const resultDiv = document.getElementById("singleResult");

  if(!recordId){
    resultDiv.innerHTML = '<span class="badge danger">Missing</span><span style="margin-left:10px">Please enter a record ID</span>';
    resultDiv.style.display = "block";
    return;
  }

  resultDiv.style.display = "block";
  resultDiv.innerHTML = "Checking...";

  try{
    const qs = new URLSearchParams();
    qs.set("recordId", recordId);
    if(stage) qs.set("stage", stage);

    const response = await fetch("/api/audit/check?" + qs.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Check failed");

    if(data.exists){
      resultDiv.innerHTML =
        '<span class="badge danger">DUPLICATE</span>' +
        '<span style="margin-left:12px">Record ID <strong>' + data.recordId + '</strong></span>' +
        (data.stage ? '<span class="muted" style="margin-left:12px">Stage: ' + data.stage + '</span>' : '') +
        '<span class="muted" style="margin-left:12px">Processed: ' + formatTimestamp(data.timestamp) + '</span>';
    } else {
      resultDiv.innerHTML =
        '<span class="badge ok">FRESH</span>' +
        '<span style="margin-left:12px">Record ID <strong>' + recordId + '</strong> has not been processed</span>' +
        (stage ? '<span class="muted" style="margin-left:12px">Stage checked: ' + stage + '</span>' : '');
    }
  } catch(err){
    resultDiv.innerHTML =
      '<span class="badge danger">ERROR</span>' +
      '<span style="margin-left:10px">' + (err && err.message ? err.message : String(err)) + '</span>';
  }
}

async function loadAuditData(page = 1){
  const loadingDiv = document.getElementById("loading");
  const errorDiv = document.getElementById("error");
  const emptyState = document.getElementById("emptyState");

  loadingDiv.style.display = "block";
  errorDiv.style.display = "none";
  emptyState.style.display = "none";

  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const searchRecordId = document.getElementById("searchRecordId").value.trim();
  const stage = document.getElementById("stage").value.trim();

  currentPage = page;

  try{
    const params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    if(searchRecordId) params.append("recordId", searchRecordId);
    if(stage) params.append("stage", stage);
    params.append("page", String(currentPage));
    params.append("pageSize", String(pageSize));

    const response = await fetch("/api/audit/browse?" + params.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Failed to load audit data");

    renderStats(data);
    renderTable(data);

    loadingDiv.style.display = "none";
  } catch(err){
    loadingDiv.style.display = "none";
    errorDiv.textContent = (err && err.message) ? err.message : String(err);
    errorDiv.style.display = "block";
  }
}

function renderStats(data){
  document.getElementById("totalRecords").textContent = (data.total || 0).toLocaleString();
  document.getElementById("todayRecords").textContent = (data.todayCount || 0).toLocaleString();
  document.getElementById("latestDate").textContent = data.latest ? formatTimestamp(data.latest) : "-";
}

function renderTable(data){
  const tbody = document.getElementById("auditResults");
  const emptyState = document.getElementById("emptyState");
  const resultsInfo = document.getElementById("resultsInfo");
  const paginationDiv = document.getElementById("pagination");

  tbody.innerHTML = "";

  const records = data.records || [];
  totalRecords = data.total || 0;

  if(records.length === 0){
    emptyState.style.display = "block";
    resultsInfo.textContent = "";
    paginationDiv.innerHTML = "";
    return;
  }

  emptyState.style.display = "none";

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + records.length, totalRecords);
  resultsInfo.textContent = "Showing " + (startIdx + 1) + " - " + endIdx + " of " + totalRecords;

  for(const record of records){
    const row = document.createElement("tr");
    row.innerHTML =
      '<td class="mono" style="color:var(--accentHi)">' + record.recordId + '</td>' +
      '<td class="muted">' + formatTimestamp(record.processedAt) + '</td>' +
      '<td style="color:var(--silver)">' + (record.source || "AuditController") + '</td>';
    tbody.appendChild(row);
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  let html = "";
  if(totalPages > 1){
    if(currentPage > 1){
      html += '<button class="secondary" onclick="loadAuditData(' + (currentPage - 1) + ')">Prev</button>';
    }
    html += '<span class="muted">Page ' + currentPage + ' of ' + totalPages + '</span>';
    if(currentPage < totalPages){
      html += '<button class="secondary" onclick="loadAuditData(' + (currentPage + 1) + ')">Next</button>';
    }
  }
  paginationDiv.innerHTML = html;
}

function resetFilters(){
  const today = new Date();
  document.getElementById("endDate").value = today.toISOString().split("T")[0];
  document.getElementById("startDate").value = today.toISOString().split("T")[0];
  document.getElementById("searchRecordId").value = "";
  document.getElementById("stage").value = "";
  loadAuditData(1);
}

loadAuditData(1);
</script>
</body>
</html>`;

// -----------------------------
// Dashboard HTML
// -----------------------------
const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>SMS Dashboard</title>
<style>
${sharedThemeCss}
.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px}
@media(max-width:900px){.stats-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.stats-grid{grid-template-columns:1fr}}
.stat-card{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:14px;
  padding:22px;
  box-shadow:var(--shadow);
  position:relative;
  overflow:hidden;
}
.stat-card:before{
  content:"";
  position:absolute;top:0;left:0;right:0;height:4px;
  background:linear-gradient(90deg, rgba(25,195,125,.9), rgba(195,204,209,.55));
}
.stat-card .icon{font-size:2rem;margin-bottom:10px;opacity:.92}
.stat-card .value{font-size:2.6rem;font-weight:950;color:var(--silver);line-height:1}
.stat-card .label{color:var(--muted);margin-top:6px;font-weight:700}
.stat-card .subvalue{color:var(--muted2);margin-top:8px;font-size:.9rem}
.stat-card.clickable{cursor:pointer;transition:transform .12s ease, filter .12s ease, border-color .12s ease}
.stat-card.clickable:hover{transform:translateY(-2px);filter:brightness(1.02);border-color:rgba(25,195,125,.75)}
.stat-card .hint{margin-top:10px;font-size:.78rem;color:rgba(152,166,173,.85)}
.kv-section{margin-bottom:16px}
.kv-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px}

/* Overlay modal */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:18px;z-index:50}
.overlay.open{display:flex}
.modal{
  width:min(1100px, 96vw);
  max-height:88vh;
  overflow:hidden;
  background:linear-gradient(180deg, rgba(16,34,28,.98), rgba(15,27,23,.98));
  border:1px solid rgba(42,59,54,.92);
  border-radius:14px;
  box-shadow:var(--shadow);
  display:flex;
  flex-direction:column;
}
.modal-header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(42,59,54,.75)}
.modal-header h2{font-size:1.1rem;color:var(--silver)}
.modal-body{padding:14px 18px 18px;overflow:auto}
.modal-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.small{font-size:.82rem}
.pager{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:12px}
.codechip{display:inline-block;padding:3px 9px;border-radius:999px;border:1px solid rgba(42,59,54,.85);background:rgba(11,18,16,.55);color:var(--muted2);font-size:.78rem}
</style>
</head>
<body>
<div class="container">
  <h1>SMS Analytics Dashboard</h1>
  <p class="subtitle">Real-time SMS conversation metrics and KV activity</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
  </div>

  <div class="panel" style="margin-bottom:16px">
    <div class="filters">
      <div class="filter-group">
        <label>Start Date</label>
        <input type="date" id="startDate" />
      </div>
      <div class="filter-group">
        <label>End Date</label>
        <input type="date" id="endDate" />
      </div>
      <div class="filter-group">
        <label>KV Prefix Filter</label>
        <select id="prefixFilter">
          <option value="">All SMS Data</option>
          <option value="conversations">Conversations</option>
          <option value="scheduledinjection">Scheduled Injections</option>
          <option value="smsflowcontext">SMS Flow Context</option>
        </select>
      </div>
      <button onclick="loadDashboard()">Apply</button>
      <button class="secondary" onclick="resetFilters()">Reset</button>
      <button class="secondary" onclick="sendReport()" id="sendReportBtn" title="Email this report to adamp@monsterrg.com">📧 Send Report</button>
    </div>
    <div id="reportStatus" style="display:none;margin-top:10px"></div>
  </div>

  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p>Loading dashboard data...</p>
  </div>
  <div id="error" class="error" style="display:none"></div>

  <div id="content" style="display:none">
    <div class="stats-grid">
      <div class="stat-card clickable" id="textsSentCard" title="Click to view sent messages">
        <div style="display:flex;gap:16px">
          <div style="flex:1;border-right:1px solid rgba(42,59,54,.75);padding-right:16px">
            <div class="icon">📤</div>
            <div class="value" id="totalTexts">-</div>
            <div class="label">Total Texts</div>
            <div class="subvalue" id="totalTextsDetail">-</div>
          </div>
          <div style="flex:1">
            <div class="icon">🚀</div>
            <div class="value" id="initialTexts">-</div>
            <div class="label">Initial Texts Sent</div>
            <div class="subvalue" id="initialTextsDetail">First message to guest</div>
          </div>
        </div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="peopleRepliedCard" title="Click to view replies">
        <div class="icon">💬</div>
        <div class="value" id="peopleReplied">-</div>
        <div class="label">People Replied</div>
        <div class="subvalue" id="peopleRepliedDetail">-</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="appointmentsCard" title="Click to view appointment entries">
        <div class="icon">📅</div>
        <div class="value" id="appointmentsSet">-</div>
        <div class="label">Appointments Booked</div>
        <div class="subvalue" id="appointmentsSetDetail">-</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card">
        <div class="icon">🗄️</div>
        <div class="value" id="totalKvEntries">-</div>
        <div class="label">Total SMS Records</div>
        <div class="subvalue" id="totalKvDetail">-</div>
      </div>

      <div class="stat-card clickable" id="activatedCard" title="Click to view activated guests">
        <div class="icon">✅</div>
        <div class="value" id="activatedCount">-</div>
        <div class="label">Activated</div>
        <div class="subvalue" id="activatedDetail">Guests marked as sale via SHA match</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="answeredCard" title="Click to view answered guests">
        <div class="icon">📞</div>
        <div class="value" id="answeredCount">-</div>
        <div class="label">Answered</div>
        <div class="subvalue" id="answeredDetail">Guests who answered the call</div>
        <div class="hint">Click to drill in</div>
      </div>
    </div>

    <!-- Injection Lookup -->
    <div class="panel" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <h2 style="color:var(--silver);font-size:1.2rem">Injection Lookup</h2>
        <span class="muted" style="font-size:.85rem">Check if a phone has a scheduled injection &amp; trigger it now</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="filter-group" style="flex:1;min-width:200px">
          <label>Phone (10 digits)</label>
          <input type="text" id="injLookupPhone" placeholder="e.g. 5551234567" />
        </div>
        <button onclick="lookupInjection()">Lookup</button>
      </div>
      <div id="injResult" style="display:none;margin-top:14px"></div>
    </div>

    <div class="panel kv-section">
      <div class="kv-header">
        <h2 style="color:var(--silver); font-size:1.2rem">SMS Storage Breakdown</h2>
        <span id="kvBreakdownInfo" class="muted"></span>
      </div>
      <table class="table">
        <thead>
          <tr><th>Prefix</th><th>Count</th><th>Latest Entry</th></tr>
        </thead>
        <tbody id="kvBreakdown"></tbody>
      </table>
    </div>

    <div class="panel kv-section">
      <div class="kv-header">
        <h2 style="color:var(--silver); font-size:1.2rem">Recent SMS Activity</h2>
        <span id="recentEntriesInfo" class="muted"></span>
      </div>
      <table class="table">
        <thead>
          <tr><th>Key</th><th>Timestamp</th><th>Preview</th></tr>
        </thead>
        <tbody id="recentEntries"></tbody>
      </table>
      <div id="emptyState" class="muted" style="display:none; text-align:center; padding:28px">
        No entries found matching your filters.
      </div>
    </div>
  </div>

  <!-- Appointments overlay -->
  <div class="overlay" id="apptOverlay" role="dialog" aria-modal="true" aria-label="Appointments detail">
    <div class="modal">
      <div class="modal-header">
        <div>
          <h2>Appointments Booked Detail</h2>
          <div class="small muted" id="apptSubtitle"></div>
        </div>
        <div class="modal-actions">
          <span class="codechip" id="apptCountChip">0</span>
          <button class="secondary" id="apptCloseBtn">Close</button>
        </div>
      </div>

      <div class="modal-body">
        <div id="apptLoading" class="loading" style="display:none">
          <div class="spinner"></div>
          <p>Loading appointment entries...</p>
        </div>
        <div id="apptError" class="error" style="display:none"></div>

        <table class="table" id="apptTable" style="display:none">
          <thead>
            <tr>
              <th>Phone</th>
              <th>Scheduled For</th>
              <th>Matched At</th>
              <th>Sender</th>
              <th>nodeTag</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody id="apptTbody"></tbody>
        </table>

        <div id="apptEmpty" class="muted" style="display:none; text-align:center; padding:28px">
          No appointment entries found for the selected filters.
        </div>

        <div class="pager" id="apptPager" style="display:none"></div>
      </div>
    </div>
  </div>
</div>

  <!-- Generic drill-in overlay -->
  <div class="overlay" id="drillOverlay" role="dialog" aria-modal="true">
    <div class="modal">
      <div class="modal-header">
        <div>
          <h2 id="drillTitle">Detail</h2>
          <div class="small muted" id="drillSubtitle"></div>
        </div>
        <div class="modal-actions">
          <span class="codechip" id="drillCountChip">0</span>
          <button class="secondary" id="drillCloseBtn">Close</button>
        </div>
      </div>
      <div class="modal-body">
        <div id="drillLoading" class="loading" style="display:none">
          <div class="spinner"></div>
          <p>Loading...</p>
        </div>
        <div id="drillError" class="error" style="display:none"></div>
        <div id="drillContent"></div>
        <div id="drillEmpty" class="muted" style="display:none; text-align:center; padding:28px">
          No entries found.
        </div>
      </div>
    </div>
  </div>

<script>
const today = new Date();
document.getElementById("endDate").value = today.toISOString().split("T")[0];
document.getElementById("startDate").value = today.toISOString().split("T")[0];

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

function extractTimestamp(entry){
  if(entry.value && entry.value.timestamp) return entry.value.timestamp;
  if(entry.value && entry.value.processedAt) return entry.value.processedAt;
  if(entry.value && entry.value.scheduledAt) return entry.value.scheduledAt;
  if(entry.value && entry.value.createdAt) return entry.value.createdAt;
  if(Array.isArray(entry.key) && entry.key.length === 4){
    const possibleTs = entry.key[3];
    if(typeof possibleTs === "string" && possibleTs.includes("T")) return possibleTs;
  }
  return null;
}

function getPreview(value){
  if(!value) return "-";
  if(typeof value === "string") return value;
  if(value.message) return value.message;
  if(value.phone) return "Phone: " + value.phone;
  if(value.recordId) return "Record: " + value.recordId;
  try { return JSON.stringify(value).substring(0,100); } catch { return String(value); }
}

function truncate(str, len){
  if(!str) return "";
  return str.length <= len ? str : str.substring(0, len) + "…";
}

function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function loadDashboard(){
  const loadingDiv = document.getElementById("loading");
  const contentDiv = document.getElementById("content");
  const errorDiv = document.getElementById("error");

  loadingDiv.style.display = "block";
  contentDiv.style.display = "none";
  errorDiv.style.display = "none";

  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const prefixFilter = document.getElementById("prefixFilter").value;

  try{
    const params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    if(prefixFilter) params.append("prefix", prefixFilter);

    const response = await fetch("/api/dashboard/stats?" + params.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Failed to load dashboard");

    renderDashboard(data);

    loadingDiv.style.display = "none";
    contentDiv.style.display = "block";
  } catch(err){
    loadingDiv.style.display = "none";
    errorDiv.textContent = (err && err.message) ? err.message : String(err);
    errorDiv.style.display = "block";
  }
}

function renderDashboard(data){
  document.getElementById("totalTexts").textContent = (data.stats.textsSent || 0).toLocaleString();
  document.getElementById("totalTextsDetail").textContent = (data.stats.uniquePhonesSent || 0) + " unique recipients";
  document.getElementById("initialTexts").textContent = (data.stats.initialTextsSent || 0).toLocaleString();
  document.getElementById("initialTextsDetail").textContent = (data.stats.initialTextsSent || 0) + " new guests reached";

  document.getElementById("peopleReplied").textContent = (data.stats.peopleReplied || 0).toLocaleString();
  const replyRate = (data.stats.uniquePhonesSent || 0) > 0
    ? ((data.stats.peopleReplied || 0) / data.stats.uniquePhonesSent * 100).toFixed(1)
    : "0";
  document.getElementById("peopleRepliedDetail").textContent = replyRate + "% reply rate";

  document.getElementById("appointmentsSet").textContent = (data.stats.appointmentsSet || 0).toLocaleString();
  const conversionRate = (data.stats.peopleReplied || 0) > 0
    ? ((data.stats.appointmentsSet || 0) / data.stats.peopleReplied * 100).toFixed(1)
    : "0";
  document.getElementById("appointmentsSetDetail").textContent = conversionRate + "% of replies booked";

  document.getElementById("totalKvEntries").textContent = (data.stats.totalKvEntries || 0).toLocaleString();
  document.getElementById("totalKvDetail").textContent = Object.keys(data.kvBreakdown || {}).length + " data types";

  // Activated + Answered counts
  document.getElementById("activatedCount").textContent = (data.stats.activatedCount || 0).toLocaleString();
  document.getElementById("answeredCount").textContent = (data.stats.answeredCount || 0).toLocaleString();

  const breakdownBody = document.getElementById("kvBreakdown");
  breakdownBody.innerHTML = "";
  const entries = Object.entries(data.kvBreakdown || {}).sort((a,b) => (b[1].count||0) - (a[1].count||0));
  for(const [prefix, info] of entries){
    const row = document.createElement("tr");
    row.innerHTML =
      '<td class="mono" style="color:var(--accentHi)">' + prefix + '</td>' +
      '<td>' + ((info.count||0).toLocaleString()) + '</td>' +
      '<td class="muted">' + (info.latest ? formatTimestamp(info.latest) : "-") + '</td>';
    breakdownBody.appendChild(row);
  }
  document.getElementById("kvBreakdownInfo").textContent = entries.length + " data types";

  const recentBody = document.getElementById("recentEntries");
  const emptyState = document.getElementById("emptyState");
  recentBody.innerHTML = "";
  if(!data.recentEntries || data.recentEntries.length === 0){
    emptyState.style.display = "block";
  } else {
    emptyState.style.display = "none";
    for(const entry of data.recentEntries){
      const row = document.createElement("tr");
      const keyStr = JSON.stringify(entry.key);
      const preview = getPreview(entry.value);
      const timestamp = extractTimestamp(entry);
      row.innerHTML =
        '<td class="mono" title="' + escapeHtml(keyStr) + '" style="color:var(--accentHi)">' + escapeHtml(truncate(keyStr, 60)) + '</td>' +
        '<td class="muted">' + (timestamp ? formatTimestamp(timestamp) : "-") + '</td>' +
        '<td class="muted" title="' + escapeHtml(preview) + '">' + escapeHtml(preview) + '</td>';
      recentBody.appendChild(row);
    }
  }
  document.getElementById("recentEntriesInfo").textContent = "Showing " + ((data.recentEntries && data.recentEntries.length) ? data.recentEntries.length : 0) + " most recent";
}

function resetFilters(){
  const today = new Date();
  document.getElementById("endDate").value = today.toISOString().split("T")[0];
  document.getElementById("startDate").value = today.toISOString().split("T")[0];
  document.getElementById("prefixFilter").value = "";
  loadDashboard();
}

async function sendReport(){
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const btn = document.getElementById("sendReportBtn");
  const statusDiv = document.getElementById("reportStatus");

  btn.disabled = true;
  btn.textContent = "Sending...";
  statusDiv.style.display = "block";
  statusDiv.innerHTML = '<span class="muted">Generating and sending report email...</span>';

  try{
    var params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);

    var res = await fetch("/api/report/nightly?" + params.toString());
    var data = await res.json();

    if(res.ok && data.success){
      statusDiv.innerHTML = '<span class="badge ok">Sent!</span><span style="margin-left:10px">Report emailed to ' + escapeHtml(data.emailSentTo || "adamp@monsterrg.com") + ' — ' + escapeHtml(data.reportDate || "") + ' (' + (data.csvRows || 0) + ' conversation rows)</span>';
    } else {
      statusDiv.innerHTML = '<span class="badge danger">Failed</span><span style="margin-left:10px">' + escapeHtml(data.error || "Unknown error") + '</span>';
    }
  } catch(err){
    statusDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = "📧 Send Report";
    setTimeout(function(){ statusDiv.style.display = "none"; }, 8000);
  }
}

// Appointments drill-in
const overlay = document.getElementById("apptOverlay");
const closeBtn = document.getElementById("apptCloseBtn");
const apptLoading = document.getElementById("apptLoading");
const apptError = document.getElementById("apptError");
const apptTable = document.getElementById("apptTable");
const apptTbody = document.getElementById("apptTbody");
const apptEmpty = document.getElementById("apptEmpty");
const apptPager = document.getElementById("apptPager");
const apptSubtitle = document.getElementById("apptSubtitle");
const apptCountChip = document.getElementById("apptCountChip");

let apptPage = 1;
let apptPageSize = 50;
let apptTotal = 0;

function openOverlay(){
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeOverlay(){
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}
closeBtn.addEventListener("click", closeOverlay);
overlay.addEventListener("click", (e) => { if(e.target === overlay) closeOverlay(); });
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && overlay.classList.contains("open")) closeOverlay(); });

document.getElementById("appointmentsCard").addEventListener("click", () => {
  apptPage = 1;
  openOverlay();
  loadAppointments(apptPage);
});

function getCurrentFiltersForAppointments(){
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const prefixFilter = document.getElementById("prefixFilter").value;
  return { startDate, endDate, prefixFilter };
}

async function loadAppointments(page){
  apptError.style.display = "none";
  apptEmpty.style.display = "none";
  apptTable.style.display = "none";
  apptPager.style.display = "none";
  apptLoading.style.display = "block";
  apptTbody.innerHTML = "";

  const { startDate, endDate, prefixFilter } = getCurrentFiltersForAppointments();
  apptSubtitle.textContent = "Filters: " +
    (startDate ? ("start " + startDate) : "start none") + ", " +
    (endDate ? ("end " + endDate) : "end none") + ", " +
    ("prefix " + (prefixFilter || "all")) + ", pageSize " + apptPageSize;

  try{
    const params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    if(prefixFilter) params.append("prefix", prefixFilter);
    params.append("page", String(page));
    params.append("pageSize", String(apptPageSize));

    const response = await fetch("/api/appointments?" + params.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Failed to load appointment entries");

    apptTotal = data.total || 0;
    apptCountChip.textContent = (apptTotal || 0).toLocaleString() + " matches";

    const items = data.items || [];
    apptLoading.style.display = "none";

    // Deduplicate by phone — keep first match per phone (most recent due to sort)
    const seenPhones = {};
    const uniqueItems = [];
    for(const it of items){
      const p = it.phoneNumber || "unknown";
      if(!seenPhones[p]){
        seenPhones[p] = true;
        uniqueItems.push(it);
      }
    }

    apptTotal = uniqueItems.length;
    apptCountChip.textContent = uniqueItems.length.toLocaleString() + " matches";

    if(uniqueItems.length === 0){
      apptEmpty.style.display = "block";
      return;
    }

    apptTable.style.display = "table";
    for(const it of uniqueItems){
      const row = document.createElement("tr");
      const scheduledForHtml = it.scheduledFor
        ? '<span style="color:var(--accentHi);font-weight:900">' + escapeHtml(formatTimestamp(it.scheduledFor)) + '</span>'
        : '<span class="muted">No injection found</span>';
      row.innerHTML =
        '<td>' + phoneLink(it.phoneNumber) + '</td>' +
        '<td>' + scheduledForHtml + '</td>' +
        '<td class="muted">' + escapeHtml(it.timestamp ? formatTimestamp(it.timestamp) : "-") + '</td>' +
        '<td>' + escapeHtml(it.sender || "-") + '</td>' +
        '<td class="muted">' + escapeHtml(it.nodeTag || "-") + '</td>' +
        '<td class="muted" title="' + escapeHtml(it.message || "") + '">' + escapeHtml(truncate(it.message || "", 120)) + '</td>';
      apptTbody.appendChild(row);
    }

    renderAppointmentsPager(data.page || page, data.pageSize || apptPageSize, data.total || 0);
  } catch(err){
    apptLoading.style.display = "none";
    apptError.textContent = (err && err.message) ? err.message : String(err);
    apptError.style.display = "block";
  }
}

function renderAppointmentsPager(page, pageSize, total){
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  apptPage = page;

  if(totalPages <= 1){
    apptPager.style.display = "none";
    apptPager.innerHTML = "";
    return;
  }

  let html = "";
  if(page > 1){
    html += '<button class="secondary" onclick="window.apptGo(' + (page - 1) + ')">Prev</button>';
  }
  html += '<span class="muted">Page ' + page + ' of ' + totalPages + '</span>';
  if(page < totalPages){
    html += '<button class="secondary" onclick="window.apptGo(' + (page + 1) + ')">Next</button>';
  }
  apptPager.innerHTML = html;
  apptPager.style.display = "flex";
}

// Expose minimal function for pager buttons
window.apptGo = (p) => loadAppointments(p);

// Injection Lookup
document.getElementById("injLookupPhone").addEventListener("keypress", (e) => {
  if(e.key === "Enter") lookupInjection();
});

async function lookupInjection(){
  const raw = (document.getElementById("injLookupPhone").value || "").replace(/\\D/g,"").slice(-10);
  const resultDiv = document.getElementById("injResult");

  if(!raw || raw.length !== 10){
    resultDiv.style.display = "block";
    resultDiv.innerHTML = '<span class="badge danger">Invalid</span><span style="margin-left:10px">Enter a valid 10-digit phone number</span>';
    return;
  }

  resultDiv.style.display = "block";
  resultDiv.innerHTML = '<span class="muted">Looking up ' + raw + '...</span>';

  try{
    const kvRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["scheduledinjection", raw])));
    const kvData = await kvRes.json();

    if(!kvData.value){
      resultDiv.innerHTML =
        '<div style="padding:14px;border-radius:10px;border:1px solid rgba(42,59,54,.85);background:rgba(15,27,23,.5)">' +
        '<span class="badge danger">Not Found</span>' +
        '<span style="margin-left:12px">No scheduled injection for <strong class="mono">' + escapeHtml(raw) + '</strong></span>' +
        '</div>';
      return;
    }

    const v = kvData.value;
    const eventTime = v.eventTime || v.appointmentAt || v.scheduledAt || null;
    const scheduledAt = v.scheduledAt || null;
    const isTest = v.isTest || false;
    const phone = v.phone || raw;

    const eventDate = eventTime ? new Date(eventTime) : null;
    const now = new Date();
    const isPast = eventDate && eventDate <= now;
    const isFuture = eventDate && eventDate > now;

    let statusBadge = "";
    if(isPast) statusBadge = '<span class="badge danger" style="margin-left:10px">Past due — ready to fire</span>';
    else if(isFuture) statusBadge = '<span class="badge ok" style="margin-left:10px">Scheduled — waiting</span>';

    let html = '<div style="padding:16px;border-radius:10px;border:1px solid rgba(42,59,54,.85);background:rgba(15,27,23,.5)">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">';
    html += '<span class="badge ok">Found</span>';
    html += '<strong class="mono" style="color:var(--accentHi);font-size:1.1rem">' + escapeHtml(phone) + '</strong>';
    html += statusBadge;
    if(isTest) html += '<span class="badge" style="background:rgba(255,159,67,.18);color:#ffd1a0;border:1px solid rgba(255,159,67,.35)">TEST</span>';
    html += '</div>';

    html += '<table style="width:100%;border-collapse:collapse">';
    html += '<tr><td style="padding:8px 0;color:var(--muted);width:160px">Event Time</td><td style="padding:8px 0;color:var(--silver);font-weight:700">' + (eventTime ? formatTimestamp(eventTime) : "-") + '</td></tr>';
    html += '<tr><td style="padding:8px 0;color:var(--muted)">Scheduled At</td><td style="padding:8px 0;color:var(--text)">' + (scheduledAt ? formatTimestamp(scheduledAt) : "-") + '</td></tr>';
    html += '<tr><td style="padding:8px 0;color:var(--muted)">Is Test</td><td style="padding:8px 0;color:var(--text)">' + (isTest ? "Yes" : "No") + '</td></tr>';
    html += '</table>';

    html += '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">';
    html += '<button onclick="triggerInjectionNow(&apos;' + escapeHtml(phone) + '&apos;)">Inject Now</button>';
    html += '<button class="secondary" onclick="cancelInjection(&apos;' + escapeHtml(phone) + '&apos;)">Cancel Injection</button>';
    html += '</div>';

    html += '</div>';
    resultDiv.innerHTML = html;
  } catch(err){
    resultDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  }
}

async function triggerInjectionNow(phone){
  const resultDiv = document.getElementById("injResult");
  const prevHtml = resultDiv.innerHTML;

  resultDiv.innerHTML = '<span class="muted">Triggering injection for ' + escapeHtml(phone) + '...</span>';

  try{
    const res = await fetch("/api/cron/trigger-single?phone=" + encodeURIComponent(phone));
    const data = await res.json();

    if(res.ok && data.success){
      resultDiv.innerHTML =
        '<div style="padding:14px;border-radius:10px;border:1px solid rgba(25,195,125,.35);background:rgba(25,195,125,.08)">' +
        '<span class="badge ok">Triggered!</span>' +
        '<span style="margin-left:12px">Injection sent for <strong class="mono">' + escapeHtml(phone) + '</strong></span>' +
        '<div class="muted" style="margin-top:8px">Response: ' + escapeHtml(data.message || "OK") + '</div>' +
        '</div>';
    } else {
      resultDiv.innerHTML =
        '<div style="padding:14px;border-radius:10px;border:1px solid rgba(255,71,87,.35);background:rgba(255,71,87,.08)">' +
        '<span class="badge danger">Failed</span>' +
        '<span style="margin-left:12px">' + escapeHtml(data.error || "Unknown error") + '</span>' +
        '</div>';
    }
  } catch(err){
    resultDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  }
}

async function cancelInjection(phone){
  const resultDiv = document.getElementById("injResult");

  if(!confirm("Cancel scheduled injection for " + phone + "?")) return;

  try{
    const res = await fetch("/api/injection/cancel?phone=" + encodeURIComponent(phone), { method: "DELETE" });
    const data = await res.json();

    if(res.ok && data.success){
      resultDiv.innerHTML =
        '<div style="padding:14px;border-radius:10px;border:1px solid rgba(255,159,67,.35);background:rgba(255,159,67,.08)">' +
        '<span class="badge" style="background:rgba(255,159,67,.18);color:#ffd1a0;border:1px solid rgba(255,159,67,.35)">Cancelled</span>' +
        '<span style="margin-left:12px">Injection for <strong class="mono">' + escapeHtml(phone) + '</strong> has been removed</span>' +
        '</div>';
    } else {
      resultDiv.innerHTML = '<span class="badge danger">Failed</span><span style="margin-left:10px">' + escapeHtml(data.error || "Unknown error") + '</span>';
    }
  } catch(err){
    resultDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  }
}

// Generic drill-in overlay
const drillOverlay = document.getElementById("drillOverlay");
const drillCloseBtn = document.getElementById("drillCloseBtn");
const drillLoading = document.getElementById("drillLoading");
const drillError = document.getElementById("drillError");
const drillContent = document.getElementById("drillContent");
const drillEmpty = document.getElementById("drillEmpty");
const drillTitle = document.getElementById("drillTitle");
const drillSubtitle = document.getElementById("drillSubtitle");
const drillCountChip = document.getElementById("drillCountChip");

function openDrill(){ drillOverlay.classList.add("open"); document.body.style.overflow = "hidden"; }
function closeDrill(){ drillOverlay.classList.remove("open"); document.body.style.overflow = ""; }
drillCloseBtn.addEventListener("click", closeDrill);
drillOverlay.addEventListener("click", function(e){ if(e.target === drillOverlay) closeDrill(); });
document.addEventListener("keydown", function(e){
  if(e.key === "Escape" && drillOverlay.classList.contains("open")) closeDrill();
});

function drillReset(){
  drillLoading.style.display = "none";
  drillError.style.display = "none";
  drillContent.innerHTML = "";
  drillEmpty.style.display = "none";
  drillCountChip.textContent = "0";
}

function renderDrillTable(items, columns){
  if(!items || items.length === 0){
    drillEmpty.style.display = "block";
    return;
  }
  drillCountChip.textContent = items.length.toLocaleString() + " entries";
  var html = '<table class="table"><thead><tr>';
  columns.forEach(function(col){ html += '<th>' + col.label + '</th>'; });
  html += '</tr></thead><tbody>';
  items.forEach(function(item){
    html += '<tr>';
    columns.forEach(function(col){
      var val = col.render ? col.render(item) : escapeHtml(item[col.key] || "-");
      html += '<td' + (col.cls ? ' class="' + col.cls + '"' : '') + (col.style ? ' style="' + col.style + '"' : '') + '>' + val + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  drillContent.innerHTML = html;
}

function phoneLink(phone){
  if(!phone) return "-";
  var p = phone.replace(/[^0-9]/g, "").slice(-10);
  return '<a href="/search?phone=' + encodeURIComponent(p) + '" target="_blank" class="mono" style="color:var(--accentHi);text-decoration:none;border-bottom:1px dashed rgba(25,195,125,.4)" title="View full conversation">' + escapeHtml(p) + '</a>';
}

// Texts Sent drill-in
document.getElementById("textsSentCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "Texts Sent";
  drillSubtitle.textContent = "All AI Bot messages for the selected date range";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var startDate = document.getElementById("startDate").value;
    var endDate = document.getElementById("endDate").value;
    var params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    params.append("sender", "AI Bot");
    var res = await fetch("/api/dashboard/drill?" + params.toString());
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    renderDrillTable(data.items, [
      { label: "Phone", render: function(m){ return phoneLink(m.phoneNumber); } },
      { label: "Time", render: function(m){ return escapeHtml(formatTimestamp(m.timestamp)); }, cls: "muted" },
      { label: "nodeTag", key: "nodeTag", cls: "muted" },
      { label: "Message", render: function(m){ return escapeHtml(truncate(m.message || "", 150)); }, cls: "muted" }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

// People Replied drill-in
document.getElementById("peopleRepliedCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "People Replied";
  drillSubtitle.textContent = "Unique guests who replied (with latest message)";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var startDate = document.getElementById("startDate").value;
    var endDate = document.getElementById("endDate").value;
    var params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    params.append("sender", "Guest");
    var res = await fetch("/api/dashboard/drill?" + params.toString());
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    // Deduplicate by phone — keep latest message per phone
    var phoneMap = {};
    (data.items || []).forEach(function(m){
      var p = m.phoneNumber || "unknown";
      if(!phoneMap[p]){
        phoneMap[p] = { phoneNumber: p, timestamp: m.timestamp, nodeTag: m.nodeTag, message: m.message, msgCount: 1 };
      } else {
        phoneMap[p].msgCount++;
        if(m.timestamp && (!phoneMap[p].timestamp || new Date(m.timestamp) > new Date(phoneMap[p].timestamp))){
          phoneMap[p].timestamp = m.timestamp;
          phoneMap[p].nodeTag = m.nodeTag;
          phoneMap[p].message = m.message;
        }
      }
    });
    var uniqueItems = Object.values(phoneMap).sort(function(a,b){
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });
    renderDrillTable(uniqueItems, [
      { label: "Phone", render: function(m){ return phoneLink(m.phoneNumber); } },
      { label: "Messages", render: function(m){ return '<span style="font-weight:900">' + m.msgCount + '</span>'; } },
      { label: "Latest Reply", render: function(m){ return escapeHtml(formatTimestamp(m.timestamp)); }, cls: "muted" },
      { label: "nodeTag", key: "nodeTag", cls: "muted" },
      { label: "Latest Message", render: function(m){ return escapeHtml(truncate(m.message || "", 120)); }, cls: "muted" }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

// Activated drill-in
document.getElementById("activatedCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "Activated Guests";
  var sd = document.getElementById("startDate").value;
  var ed = document.getElementById("endDate").value;
  drillSubtitle.textContent = "Guests marked as sale via SHA phone match (" + (sd || "all") + " to " + (ed || "all") + ")";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["guestactivated"], limit: 500 })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    var items = (data.entries || []).map(function(e){ return e.value; });
    // Date filter client-side using ET boundaries
    if(sd){
      var startMs = new Date(sd + "T00:00:00-04:00").getTime();
      items = items.filter(function(m){ return !m.activatedAt || new Date(m.activatedAt).getTime() >= startMs; });
    }
    if(ed){
      var endMs = new Date(ed + "T23:59:59-04:00").getTime();
      items = items.filter(function(m){ return !m.activatedAt || new Date(m.activatedAt).getTime() <= endMs; });
    }
    renderDrillTable(items, [
      { label: "Phone", render: function(m){ return phoneLink(m.phone10); } },
      { label: "Activated At", render: function(m){ return escapeHtml(formatTimestamp(m.activatedAt)); }, cls: "muted" },
      { label: "Event Time", render: function(m){ return escapeHtml(formatTimestamp(m.eventTime)); } },
      { label: "Status", render: function(m){ return m.Activated ? '<span class="badge ok">Activated</span>' : '-'; } }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

// Answered drill-in
document.getElementById("answeredCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "Answered Guests";
  var sd = document.getElementById("startDate").value;
  var ed = document.getElementById("endDate").value;
  drillSubtitle.textContent = "Guests who answered the confirmation call (" + (sd || "all") + " to " + (ed || "all") + ")";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["guestanswered"], limit: 500 })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    var items = (data.entries || []).map(function(e){ return e.value; });
    // Date filter client-side using ET boundaries
    if(sd){
      var startMs = new Date(sd + "T00:00:00-04:00").getTime();
      items = items.filter(function(m){ return !m.answeredAt || new Date(m.answeredAt).getTime() >= startMs; });
    }
    if(ed){
      var endMs = new Date(ed + "T23:59:59-04:00").getTime();
      items = items.filter(function(m){ return !m.answeredAt || new Date(m.answeredAt).getTime() <= endMs; });
    }
    renderDrillTable(items, [
      { label: "Phone", render: function(m){ return phoneLink(m.phone10); } },
      { label: "Answered At", render: function(m){ return escapeHtml(formatTimestamp(m.answeredAt)); }, cls: "muted" },
      { label: "Status", render: function(m){ return m.answered ? '<span class="badge ok">Answered</span>' : '-'; } }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

loadDashboard();
</script>
</body>
</html>`;

// -----------------------------
// Search UI HTML
// -----------------------------
const searchPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Conversation Search</title>
<style>
${sharedThemeCss}
.container{max-width:980px;margin:0 auto}
.search-box{display:flex;gap:10px;margin-bottom:14px}
.results-summary{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  padding:14px 16px;
  margin-bottom:14px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  flex-wrap:wrap;
  gap:10px;
  box-shadow:var(--shadow);
}
.results-summary h2{font-size:1.05rem;color:var(--silver)}
.conversation{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  margin-bottom:12px;
  overflow:hidden;
  box-shadow:var(--shadow);
}
.conversation-header{
  background:rgba(19,42,35,.75);
  padding:14px 16px;
  cursor:pointer;
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
}
.conversation-header:hover{background:rgba(25,195,125,.10)}
.conversation-header h3{font-size:.98rem;color:var(--accentHi);word-break:break-all;user-select:text;-webkit-user-select:text}
.conversation-header .meta{color:var(--muted);font-size:.85rem;white-space:nowrap;flex-shrink:0}
.conversation-messages{display:none;padding:14px 16px;border-top:1px solid rgba(42,59,54,.85)}
.conversation.expanded .conversation-messages{display:block}
.message{
  padding:12px 14px;
  margin-bottom:10px;
  border-radius:12px;
  max-width:82%;
  border:1px solid rgba(42,59,54,.75);
}
.message:last-child{margin-bottom:0}
.message.guest{background:rgba(25,195,125,.10);margin-right:auto}
.message.ai{background:rgba(195,204,209,.08);margin-left:auto}
.message .sender{font-weight:800;font-size:.8rem;margin-bottom:6px;color:var(--silver)}
.message .content{line-height:1.45;color:var(--text)}
.message .timestamp{font-size:.75rem;color:var(--muted2);margin-top:8px}
.tag{
  display:inline-block;
  background:rgba(25,195,125,.16);
  border:1px solid rgba(25,195,125,.35);
  color:#b8ffe2;
  font-size:.7rem;
  padding:2px 8px;
  border-radius:999px;
  margin-left:8px;
  font-weight:900;
}
.opted-out{
  background:rgba(255,71,87,.18);
  border:1px solid rgba(255,71,87,.35);
  color:#ffd1d7;
  padding:4px 10px;
  border-radius:999px;
  font-size:.78rem;
  margin-left:10px;
  font-weight:900;
}
.mini-filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.mini-filters .filter-group{flex:1;min-width:160px}
.guest-status-panel{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  padding:16px;
  margin-bottom:14px;
  box-shadow:var(--shadow);
}
.guest-status-panel h3{color:var(--silver);font-size:1rem;margin-bottom:12px}
.status-row{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.status-item{
  display:flex;align-items:center;gap:8px;
  padding:8px 14px;
  border:1px solid rgba(42,59,54,.85);
  border-radius:10px;
  background:rgba(11,18,16,.5);
}
.status-item .status-label{color:var(--muted);font-size:.85rem;font-weight:600}
.status-item .status-badge{font-weight:900;font-size:.85rem}
.status-item button{
  padding:4px 12px;font-size:.8rem;height:auto;
  border-radius:8px;
}
.nodetag-row{
  display:flex;align-items:center;gap:8px;margin-top:6px;
}
.nodetag-row label{color:var(--muted);font-size:.75rem;font-weight:700;white-space:nowrap}
.nodetag-input{
  padding:3px 8px;font-size:.75rem;
  border:1px solid rgba(42,59,54,.85);
  border-radius:6px;
  background:rgba(11,18,16,.6);
  color:var(--text);
  width:140px;
  outline:none;
}
.nodetag-input:focus{border-color:rgba(25,195,125,.7);box-shadow:0 0 0 2px rgba(25,195,125,.12)}
.nodetag-save{
  padding:2px 8px;font-size:.7rem;height:auto;
  border-radius:6px;cursor:pointer;
  background:var(--accent);color:#08110e;border:none;font-weight:800;
}
.nodetag-save:hover{filter:brightness(1.1)}
.nodetag-saved{color:var(--accentHi);font-size:.7rem;font-weight:700;opacity:0;transition:opacity .3s}
</style>
</head>
<body>
<div class="container">
  <h1>Conversation Search</h1>
  <p class="subtitle">Search SMS conversations by phone number with optional filters</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
  </div>

  <div class="panel">
    <div class="search-box">
      <input type="text" id="phoneInput" placeholder="Phone (10 digits) e.g., 5551234567" autofocus />
      <button id="searchBtn" onclick="searchConversations()">Search</button>
    </div>

    <div class="mini-filters">
      <div class="filter-group">
        <label>Call ID contains (optional)</label>
        <input type="text" id="callIdFilter" placeholder="partial callId..." />
      </div>
      <div class="filter-group">
        <label>Sender (optional)</label>
        <input type="text" id="senderFilter" placeholder="Guest / AI Bot" />
      </div>
      <div class="filter-group">
        <label>nodeTag contains (optional)</label>
        <input type="text" id="nodeTagFilter" placeholder="e.g. appointment" />
      </div>
      <div class="filter-group">
        <label>Message contains (optional)</label>
        <input type="text" id="containsFilter" placeholder="substring..." />
      </div>
    </div>
    <p class="muted">This uses <span class="mono">/api/conversations/search2</span> stream-filtered to avoid extra client work.</p>
  </div>

  <div id="status" class="loading" style="display:none">
    <div class="spinner"></div>
    <p id="statusText">Searching...</p>
  </div>
  <div id="error" class="error" style="display:none"></div>

  <div id="results" style="margin-top:16px"></div>
</div>

<script>
const phoneInput = document.getElementById("phoneInput");
const searchBtn = document.getElementById("searchBtn");
const statusWrap = document.getElementById("status");
const statusText = document.getElementById("statusText");
const errorDiv = document.getElementById("error");
const resultsDiv = document.getElementById("results");

function normalizePhone(phone){
  return (phone || "").replace(/\\D/g,"").slice(-10);
}

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(str, len){
  if(!str) return "";
  return str.length <= len ? str : str.substring(0, len) + "…";
}

phoneInput.addEventListener("keypress", (e) => {
  if(e.key === "Enter") searchConversations();
});

async function searchConversations(){
  const phone = normalizePhone(phoneInput.value);
  const callId = document.getElementById("callIdFilter").value.trim();
  const sender = document.getElementById("senderFilter").value.trim();
  const nodeTag = document.getElementById("nodeTagFilter").value.trim();
  const contains = document.getElementById("containsFilter").value.trim();

  if(!phone || phone.length !== 10){
    errorDiv.textContent = "Please enter a valid 10-digit phone number";
    errorDiv.style.display = "block";
    return;
  }

  errorDiv.style.display = "none";
  resultsDiv.innerHTML = "";
  searchBtn.disabled = true;
  statusWrap.style.display = "block";
  statusText.textContent = "Searching...";

  try{
    const qs = new URLSearchParams();
    qs.set("phone", phone);
    if(callId) qs.set("callId", callId);
    if(sender) qs.set("sender", sender);
    if(nodeTag) qs.set("nodeTag", nodeTag);
    if(contains) qs.set("contains", contains);

    const response = await fetch("/api/conversations/search2?" + qs.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Search failed");

    if(!data.conversations || data.conversations.length === 0){
      statusText.textContent = "No results found";
      searchBtn.disabled = false;
      return;
    }

    statusWrap.style.display = "none";
    renderResults(phone, data.conversations, data.optedOut);
  } catch(err){
    statusWrap.style.display = "none";
    errorDiv.textContent = (err && err.message) ? err.message : String(err);
    errorDiv.style.display = "block";
  } finally {
    searchBtn.disabled = false;
  }
}

function renderResults(phone, conversations, optedOut){
  const grouped = {};
  conversations.forEach((msg) => {
    const id = msg.callId || "no-callId";
    if(!grouped[id]) grouped[id] = [];
    grouped[id].push(msg);
  });

  Object.values(grouped).forEach((msgs) => msgs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp)));

  const sortedCallIds = Object.keys(grouped).sort((a,b) => {
    const aLast = grouped[a][grouped[a].length - 1].timestamp;
    const bLast = grouped[b][grouped[b].length - 1].timestamp;
    return new Date(bLast) - new Date(aLast);
  });

  let html = '<div class="results-summary">';
  html += '<h2>Phone ' + escapeHtml(phone) + (optedOut ? ' <span class="opted-out">OPTED OUT</span>' : '') + '</h2>';
  html += '<span class="muted">' + sortedCallIds.length + ' conversations, ' + conversations.length + ' messages</span>';
  html += '</div>';

  // Guest status panel
  html += '<div class="guest-status-panel" id="guestStatusPanel">';
  html += '<h3>Guest Status for ' + escapeHtml(phone) + '</h3>';
  html += '<div class="status-row">';
  html += '<div class="status-item"><span class="status-label">Activated:</span><span class="status-badge" id="statusActivated">Loading...</span><button class="secondary" id="btnToggleActivated" style="display:none" onclick="toggleGuestStatus(&apos;activated&apos;)">Toggle</button></div>';
  html += '<div class="status-item"><span class="status-label">Answered:</span><span class="status-badge" id="statusAnswered">Loading...</span><button class="secondary" id="btnToggleAnswered" style="display:none" onclick="toggleGuestStatus(&apos;answered&apos;)">Toggle</button></div>';
  html += '<div class="status-item"><span class="status-label">Injection:</span><span class="status-badge" id="statusInjection">Loading...</span></div>';
  html += '</div>';
  html += '</div>';

  // Store phone globally for status operations
  window._currentPhone = phone;

  sortedCallIds.forEach((callId, index) => {
    const messages = grouped[callId];
    const lastMsg = messages[messages.length - 1];
    const isExpanded = index === 0 ? "expanded" : "";

    html += '<div class="conversation ' + isExpanded + '">';
    html += '<div class="conversation-header" onclick="toggleConversation(this)">';
    html += '<h3>Call ID ' + escapeHtml(callId) + '</h3>';
    html += '<div class="meta">' + messages.length + ' msgs • ' + formatTimestamp(lastMsg.timestamp) + '</div>';
    html += '</div>';

    html += '<div class="conversation-messages">';
    messages.forEach((msg, msgIdx) => {
      const isGuest = msg.sender === "Guest";
      const msgId = "msg_" + callId.substring(0, 8) + "_" + msgIdx;
      const kvKeyJson = JSON.stringify(msg._kvKey || null);
      html += '<div class="message ' + (isGuest ? "guest" : "ai") + '" data-kvkey="' + escapeHtml(kvKeyJson) + '">';
      html += '<div class="sender">' + escapeHtml(msg.sender || "Unknown") +
        (msg.nodeTag ? '<span class="tag">' + escapeHtml(msg.nodeTag) + '</span>' : '') +
        '</div>';
      html += '<div class="content">' + escapeHtml(msg.message || "") + '</div>';
      html += '<div class="timestamp">' + formatTimestamp(msg.timestamp) + '</div>';
      // Editable nodeTag row
      html += '<div class="nodetag-row">';
      html += '<label>Node Tag:</label>';
      html += '<input class="nodetag-input" id="' + msgId + '_tag" value="' + escapeHtml(msg.nodeTag || "") + '" placeholder="(none)" />';
      html += '<button class="nodetag-save" onclick="saveNodeTag(this, &apos;' + escapeHtml(phone) + '&apos;, &apos;' + escapeHtml(msg.callId || "") + '&apos;, &apos;' + escapeHtml(msg.timestamp || "") + '&apos;, &apos;' + msgId + '_tag&apos;)">Save</button>';
      html += '<span class="nodetag-saved" id="' + msgId + '_saved">Saved!</span>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  });

  resultsDiv.innerHTML = html;

  // Load guest statuses
  loadGuestStatus(phone);
}

function toggleConversation(header){
  const conv = header.parentElement;
  conv.classList.toggle("expanded");
}

async function loadGuestStatus(phone){
  try{
    // Fetch activated status
    const actRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["guestactivated", phone])));
    const actData = await actRes.json();
    const actEl = document.getElementById("statusActivated");
    const actBtn = document.getElementById("btnToggleActivated");
    if(actData.value && actData.value.Activated){
      actEl.innerHTML = '<span class="badge ok">Yes</span> <span class="muted" style="font-size:.75rem">' + escapeHtml(formatTimestamp(actData.value.activatedAt)) + '</span>';
      actBtn.textContent = "Remove";
    } else {
      actEl.innerHTML = '<span class="badge danger">No</span>';
      actBtn.textContent = "Activate";
    }
    actBtn.style.display = "inline-block";

    // Fetch answered status
    const ansRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["guestanswered", phone])));
    const ansData = await ansRes.json();
    const ansEl = document.getElementById("statusAnswered");
    const ansBtn = document.getElementById("btnToggleAnswered");
    if(ansData.value && ansData.value.answered){
      ansEl.innerHTML = '<span class="badge ok">Yes</span> <span class="muted" style="font-size:.75rem">' + escapeHtml(formatTimestamp(ansData.value.answeredAt)) + '</span>';
      ansBtn.textContent = "Remove";
    } else {
      ansEl.innerHTML = '<span class="badge danger">No</span>';
      ansBtn.textContent = "Mark Answered";
    }
    ansBtn.style.display = "inline-block";

    // Fetch injection status
    const injRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["scheduledinjection", phone])));
    const injData = await injRes.json();
    const injEl = document.getElementById("statusInjection");
    if(injData.value){
      const et = injData.value.eventTime || injData.value.scheduledAt || null;
      injEl.innerHTML = '<span class="badge ok">Scheduled</span> <span class="muted" style="font-size:.75rem">' + (et ? escapeHtml(formatTimestamp(et)) : "no time") + '</span>';
    } else {
      injEl.innerHTML = '<span class="muted">None</span>';
    }
  } catch(err){
    console.log("Error loading guest status:", err);
  }
}

async function toggleGuestStatus(type){
  const phone = window._currentPhone;
  if(!phone) return;

  if(type === "activated"){
    const actRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["guestactivated", phone])));
    const actData = await actRes.json();

    if(actData.value && actData.value.Activated){
      // Remove
      await fetch("/api/kv/delete?key=" + encodeURIComponent(JSON.stringify(["guestactivated", phone])), { method: "DELETE" });
    } else {
      // Activate
      await fetch("/api/kv/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: ["guestactivated", phone],
          value: { phone10: phone, Activated: true, activatedAt: new Date().toISOString(), eventTime: null }
        })
      });
    }
    loadGuestStatus(phone);
  }

  if(type === "answered"){
    const ansRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["guestanswered", phone])));
    const ansData = await ansRes.json();

    if(ansData.value && ansData.value.answered){
      // Remove
      await fetch("/api/kv/delete?key=" + encodeURIComponent(JSON.stringify(["guestanswered", phone])), { method: "DELETE" });
    } else {
      // Mark answered
      await fetch("/api/kv/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: ["guestanswered", phone],
          value: { phone10: phone, answered: true, answeredAt: new Date().toISOString() }
        })
      });
    }
    loadGuestStatus(phone);
  }
}

async function saveNodeTag(btn, phone, callId, timestamp, inputId){
  const input = document.getElementById(inputId);
  const savedEl = document.getElementById(inputId.replace("_tag", "_saved"));
  const newTag = input.value.trim();

  btn.disabled = true;
  btn.textContent = "...";

  try{
    // Find the KV entry by listing conversations for this phone+callId and matching timestamp
    const listRes = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["conversations", phone], limit: 500 })
    });
    const listData = await listRes.json();

    // Find the matching entry by callId + timestamp
    let targetEntry = null;
    for(const entry of (listData.entries || [])){
      const v = entry.value;
      if(v && v.callId === callId && v.timestamp === timestamp){
        targetEntry = entry;
        break;
      }
    }

    if(!targetEntry){
      alert("Could not find the matching KV entry for this message.");
      btn.disabled = false;
      btn.textContent = "Save";
      return;
    }

    // Update the value with the new nodeTag
    const updatedValue = Object.assign({}, targetEntry.value, { nodeTag: newTag || null });

    await fetch("/api/kv/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: targetEntry.key, value: updatedValue })
    });

    btn.textContent = "Save";
    btn.disabled = false;

    // Flash saved indicator
    savedEl.style.opacity = "1";
    setTimeout(function(){ savedEl.style.opacity = "0"; }, 2000);

    // Update the tag badge inline
    const msgEl = btn.closest(".message");
    const senderEl = msgEl.querySelector(".sender");
    const existingTag = senderEl.querySelector(".tag");
    if(newTag){
      if(existingTag){
        existingTag.textContent = newTag;
      } else {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = newTag;
        senderEl.appendChild(span);
      }
    } else {
      if(existingTag) existingTag.remove();
    }
  } catch(err){
    btn.textContent = "Save";
    btn.disabled = false;
    alert("Error saving nodeTag: " + String(err));
  }
}

// Auto-fill and search if ?phone= is in URL
(function(){
  const urlParams = new URLSearchParams(window.location.search);
  const phoneParam = urlParams.get("phone");
  if(phoneParam){
    phoneInput.value = phoneParam;
    searchConversations();
  }
})();
</script>
</body>
</html>`;

// -----------------------------
// Injections Page HTML
// -----------------------------
const injectionsPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Scheduled Injections</title>
<style>
${sharedThemeCss}
.container{max-width:1100px;margin:0 auto}
.schedule-form{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.schedule-form .filter-group{display:flex;flex-direction:column;gap:6px}
.inj-table{width:100%;border-collapse:collapse;margin-top:12px}
.inj-table th,.inj-table td{padding:12px 15px;text-align:left;border-bottom:1px solid rgba(42,59,54,.9)}
.inj-table th{color:var(--muted);font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em}
.inj-table tr:hover{background:rgba(25,195,125,.06)}
.time-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:800}
.time-badge.past{background:rgba(255,71,87,.18);color:#ffd1d7;border:1px solid rgba(255,71,87,.35)}
.time-badge.future{background:rgba(25,195,125,.16);color:#b8ffe2;border:1px solid rgba(25,195,125,.35)}
.time-badge.soon{background:rgba(255,159,67,.18);color:#ffd1a0;border:1px solid rgba(255,159,67,.35)}
.action-btns{display:flex;gap:6px}
.action-btns button{padding:4px 10px;font-size:.8rem;height:auto;border-radius:8px}
</style>
</head>
<body>
<div class="container">
  <h1>Scheduled Injections</h1>
  <p class="subtitle">View upcoming injections and schedule new ones</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
  </div>

  <!-- Schedule new injection -->
  <div class="panel" style="margin-bottom:16px">
    <h3 style="color:var(--silver);margin-bottom:12px">Schedule New Injection</h3>
    <div class="schedule-form">
      <div class="filter-group" style="flex:1;min-width:180px">
        <label style="font-size:.85rem;color:var(--muted)">Phone (10 digits)</label>
        <input type="text" id="schedPhone" placeholder="e.g. 5551234567" />
      </div>
      <div class="filter-group">
        <label style="font-size:.85rem;color:var(--muted)">Date</label>
        <input type="date" id="schedDate" />
      </div>
      <div class="filter-group">
        <label style="font-size:.85rem;color:var(--muted)">Time (ET)</label>
        <input type="time" id="schedTime" value="13:00" />
      </div>
      <div class="filter-group">
        <label style="font-size:.85rem;color:var(--muted)">Test?</label>
        <select id="schedIsTest">
          <option value="false">No (Production)</option>
          <option value="true">Yes (Test)</option>
        </select>
      </div>
      <button onclick="scheduleInjection()">Schedule</button>
    </div>
    <div id="schedResult" style="display:none;margin-top:12px"></div>
  </div>

  <!-- List of all scheduled injections -->
  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <h3 style="color:var(--silver)">All Scheduled Injections</h3>
      <div style="display:flex;gap:10px;align-items:center">
        <span class="muted" id="injCount">Loading...</span>
        <button class="secondary" onclick="loadInjections()">Refresh</button>
      </div>
    </div>

    <div id="injLoading" class="loading">
      <div class="spinner"></div>
      <p>Loading injections...</p>
    </div>
    <div id="injError" class="error" style="display:none"></div>

    <div id="injContent" style="display:none">
      <table class="inj-table">
        <thead>
          <tr>
            <th>Phone</th>
            <th>Event Time</th>
            <th>Status</th>
            <th>Scheduled At</th>
            <th>Test</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="injTbody"></tbody>
      </table>
      <div id="injEmpty" class="muted" style="display:none;text-align:center;padding:28px">
        No scheduled injections found.
      </div>
    </div>
  </div>

  <!-- Injection History -->
  <div class="panel" style="margin-top:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <h3 style="color:var(--silver)">Injection History</h3>
      <div style="display:flex;gap:10px;align-items:center">
        <span class="muted" id="histCount">Loading...</span>
        <button class="secondary" onclick="loadHistory()">Refresh</button>
      </div>
    </div>

    <div id="histLoading" class="loading" style="display:none">
      <div class="spinner"></div>
      <p>Loading history...</p>
    </div>

    <div id="histContent" style="display:none">
      <table class="inj-table">
        <thead>
          <tr>
            <th>Phone</th>
            <th>Event Time</th>
            <th>Fired At</th>
            <th>Fired By</th>
            <th>Status</th>
            <th>Test</th>
          </tr>
        </thead>
        <tbody id="histTbody"></tbody>
      </table>
      <div id="histEmpty" class="muted" style="display:none;text-align:center;padding:28px">
        No injection history yet. History is recorded when injections fire.
      </div>
    </div>
  </div>
</div>

<script>
// Set default schedule date to today
const today = new Date();
document.getElementById("schedDate").value = today.toISOString().split("T")[0];

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function getTimeBadge(eventTime){
  if(!eventTime) return '<span class="time-badge past">No time</span>';
  const et = new Date(eventTime).getTime();
  const now = Date.now();
  const diffMs = et - now;
  const diffMins = Math.round(diffMs / 60000);

  if(diffMs < 0){
    return '<span class="time-badge past">Past due (' + Math.abs(diffMins) + 'm ago)</span>';
  } else if(diffMs < 3600000){
    return '<span class="time-badge soon">In ' + diffMins + 'm</span>';
  } else {
    const diffHrs = Math.round(diffMs / 3600000);
    if(diffHrs < 24){
      return '<span class="time-badge future">In ' + diffHrs + 'h</span>';
    } else {
      const diffDays = Math.round(diffMs / 86400000);
      return '<span class="time-badge future">In ' + diffDays + 'd</span>';
    }
  }
}

async function loadInjections(){
  const loadingDiv = document.getElementById("injLoading");
  const errorDiv = document.getElementById("injError");
  const contentDiv = document.getElementById("injContent");
  const emptyDiv = document.getElementById("injEmpty");
  const countEl = document.getElementById("injCount");
  const tbody = document.getElementById("injTbody");

  loadingDiv.style.display = "block";
  contentDiv.style.display = "none";
  errorDiv.style.display = "none";

  try{
    const res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["scheduledinjection"], limit: 500 })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    const entries = (data.entries || []).map(function(e){
      return { phone: e.key[1], value: e.value };
    });

    // Sort by eventTime ascending (soonest first)
    entries.sort(function(a, b){
      const at = a.value.eventTime ? new Date(a.value.eventTime).getTime() : Infinity;
      const bt = b.value.eventTime ? new Date(b.value.eventTime).getTime() : Infinity;
      return at - bt;
    });

    loadingDiv.style.display = "none";
    contentDiv.style.display = "block";
    countEl.textContent = entries.length + " injection" + (entries.length !== 1 ? "s" : "");

    tbody.innerHTML = "";

    if(entries.length === 0){
      emptyDiv.style.display = "block";
      return;
    }
    emptyDiv.style.display = "none";

    entries.forEach(function(entry){
      const v = entry.value;
      const row = document.createElement("tr");
      row.innerHTML =
        '<td><a href="/search?phone=' + encodeURIComponent(entry.phone) + '" target="_blank" class="mono" style="color:var(--accentHi);text-decoration:none;border-bottom:1px dashed rgba(25,195,125,.4)">' + escapeHtml(entry.phone) + '</a></td>' +
        '<td style="color:var(--silver);font-weight:700">' + escapeHtml(formatTimestamp(v.eventTime)) + '</td>' +
        '<td>' + getTimeBadge(v.eventTime) + '</td>' +
        '<td class="muted">' + escapeHtml(formatTimestamp(v.scheduledAt)) + '</td>' +
        '<td>' + (v.isTest ? '<span class="time-badge soon">TEST</span>' : '<span class="muted">Prod</span>') + '</td>' +
        '<td><div class="action-btns">' +
          '<button onclick="fireInjection(&apos;' + escapeHtml(entry.phone) + '&apos;, this)">Fire Now</button>' +
          '<button class="secondary" onclick="cancelInjection(&apos;' + escapeHtml(entry.phone) + '&apos;, this)">Cancel</button>' +
        '</div></td>';
      tbody.appendChild(row);
    });
  } catch(err){
    loadingDiv.style.display = "none";
    errorDiv.textContent = String(err.message || err);
    errorDiv.style.display = "block";
  }
}

async function scheduleInjection(){
  const phone = (document.getElementById("schedPhone").value || "").replace(/[^0-9]/g, "").slice(-10);
  const date = document.getElementById("schedDate").value;
  const time = document.getElementById("schedTime").value;
  const isTest = document.getElementById("schedIsTest").value === "true";
  const resultDiv = document.getElementById("schedResult");

  if(!phone || phone.length !== 10){
    resultDiv.style.display = "block";
    resultDiv.innerHTML = '<span class="badge danger">Invalid</span><span style="margin-left:10px">Enter a valid 10-digit phone</span>';
    return;
  }
  if(!date || !time){
    resultDiv.style.display = "block";
    resultDiv.innerHTML = '<span class="badge danger">Missing</span><span style="margin-left:10px">Enter a date and time</span>';
    return;
  }

  // Build ET datetime — assume Eastern Time input, convert to ISO
  // We store the ISO string and the cron compares against Date.now()
  const eventTimeLocal = date + "T" + time + ":00";
  // Create as ET (approximate — use America/New_York offset)
  const etDate = new Date(eventTimeLocal + "-04:00"); // EDT
  const eventTimeISO = etDate.toISOString();

  resultDiv.style.display = "block";
  resultDiv.innerHTML = '<span class="muted">Scheduling...</span>';

  try{
    const res = await fetch("/api/injection/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone, eventTime: eventTimeISO, isTest: isTest })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    resultDiv.innerHTML = '<span class="badge ok">Scheduled!</span><span style="margin-left:10px">Phone ' + escapeHtml(phone) + ' at ' + escapeHtml(formatTimestamp(eventTimeISO)) + (isTest ? ' (TEST)' : '') + '</span>';
    document.getElementById("schedPhone").value = "";
    loadInjections();
  } catch(err){
    resultDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  }
}

async function fireInjection(phone, btn){
  btn.disabled = true;
  btn.textContent = "...";
  try{
    const res = await fetch("/api/cron/trigger-single?phone=" + encodeURIComponent(phone));
    const data = await res.json();
    if(res.ok && data.success){
      btn.textContent = "Fired!";
      btn.style.background = "var(--accent)";
      btn.style.color = "#08110e";
      setTimeout(function(){ loadInjections(); }, 1500);
    } else {
      btn.textContent = "Failed";
      alert("Fire failed: " + (data.error || "Unknown error"));
      btn.disabled = false;
      btn.textContent = "Fire Now";
    }
  } catch(err){
    alert("Error: " + String(err));
    btn.disabled = false;
    btn.textContent = "Fire Now";
  }
}

async function cancelInjection(phone, btn){
  if(!confirm("Cancel injection for " + phone + "?")) return;
  btn.disabled = true;
  btn.textContent = "...";
  try{
    const res = await fetch("/api/injection/cancel?phone=" + encodeURIComponent(phone), { method: "DELETE" });
    const data = await res.json();
    if(res.ok && data.success){
      loadInjections();
    } else {
      alert("Cancel failed: " + (data.error || "Unknown error"));
      btn.disabled = false;
      btn.textContent = "Cancel";
    }
  } catch(err){
    alert("Error: " + String(err));
    btn.disabled = false;
    btn.textContent = "Cancel";
  }
}

async function loadHistory(){
  var loading = document.getElementById("histLoading");
  var content = document.getElementById("histContent");
  var empty = document.getElementById("histEmpty");
  var countEl = document.getElementById("histCount");
  var tbody = document.getElementById("histTbody");

  loading.style.display = "block";
  content.style.display = "none";

  try{
    var res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["injectionhistory"], limit: 200 })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    var entries = (data.entries || []).map(function(e){
      return { phone: e.key[1], firedAt: e.key[2], value: e.value };
    });

    entries.sort(function(a, b){
      return new Date(b.firedAt || 0) - new Date(a.firedAt || 0);
    });

    loading.style.display = "none";
    content.style.display = "block";
    countEl.textContent = entries.length + " record" + (entries.length !== 1 ? "s" : "");

    tbody.innerHTML = "";

    if(entries.length === 0){
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";

    entries.forEach(function(entry){
      var v = entry.value || {};
      var row = document.createElement("tr");
      var statusBadge = v.status === "success"
        ? '<span class="time-badge future">Success</span>'
        : '<span class="time-badge past">' + escapeHtml(v.status || "unknown") + '</span>';
      var firedByBadge = v.firedBy === "manual"
        ? '<span class="time-badge soon">Manual</span>'
        : '<span class="time-badge future">Cron</span>';
      row.innerHTML =
        '<td><a href="/search?phone=' + encodeURIComponent(entry.phone) + '" target="_blank" class="mono" style="color:var(--accentHi);text-decoration:none;border-bottom:1px dashed rgba(25,195,125,.4)">' + escapeHtml(entry.phone) + '</a></td>' +
        '<td class="muted">' + escapeHtml(formatTimestamp(v.eventTime)) + '</td>' +
        '<td style="color:var(--silver);font-weight:700">' + escapeHtml(formatTimestamp(v.firedAt)) + '</td>' +
        '<td>' + firedByBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + (v.isTest ? '<span class="time-badge soon">TEST</span>' : '<span class="muted">Prod</span>') + '</td>';
      tbody.appendChild(row);
    });
  } catch(err){
    loading.style.display = "none";
    content.style.display = "block";
    empty.style.display = "block";
    empty.textContent = "Error: " + String(err);
  }
}

loadInjections();
loadHistory();
</script>
</body>
</html>`;

// -----------------------------
// Review Responses Page HTML
// -----------------------------
const reviewPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Review Responses</title>
<style>
${sharedThemeCss}
.container{max-width:1200px;margin:0 auto}
.date-bar{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px}
.date-bar .filter-group{display:flex;flex-direction:column;gap:6px}
.resp-card{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  margin-bottom:10px;
  overflow:hidden;
  box-shadow:var(--shadow);
  transition:border-color .2s;
}
.resp-card:hover{border-color:rgba(25,195,125,.45)}
.resp-header{
  display:flex;justify-content:space-between;align-items:center;
  padding:14px 18px;cursor:pointer;gap:12px;flex-wrap:wrap;
}
.resp-header:hover{background:rgba(25,195,125,.06)}
.resp-phone{font-family:monospace;font-weight:900;font-size:1.05rem;color:var(--accentHi)}
.resp-meta{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.resp-meta .chip{
  display:inline-block;padding:3px 10px;border-radius:999px;
  font-size:.78rem;font-weight:800;
  background:rgba(25,195,125,.16);color:#b8ffe2;border:1px solid rgba(25,195,125,.35);
}
.resp-meta .muted{font-size:.85rem}
.resp-preview{color:var(--text);font-size:.88rem;max-width:400px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.resp-links{display:flex;gap:8px;align-items:center}
.resp-links a{
  display:inline-flex;align-items:center;gap:5px;
  padding:5px 12px;border-radius:8px;font-size:.8rem;font-weight:700;
  text-decoration:none;transition:background .2s;
}
.link-bland{background:rgba(99,102,241,.18);color:#c4b5fd;border:1px solid rgba(99,102,241,.35)}
.link-bland:hover{background:rgba(99,102,241,.3)}
.link-search{background:rgba(25,195,125,.12);color:#b8ffe2;border:1px solid rgba(25,195,125,.3)}
.link-search:hover{background:rgba(25,195,125,.22)}
.resp-convo{display:none;padding:14px 18px;border-top:1px solid rgba(42,59,54,.85)}
.resp-card.open .resp-convo{display:block}
.msg{
  max-width:80%;padding:12px 16px;border-radius:12px;margin-bottom:10px;
  position:relative;
}
.msg.guest{background:rgba(25,195,125,.10);margin-right:auto}
.msg.ai{background:rgba(195,204,209,.08);margin-left:auto}
.msg .msg-sender{font-weight:800;font-size:.8rem;margin-bottom:4px;color:var(--silver)}
.msg .msg-tag{
  display:inline-block;background:rgba(25,195,125,.16);border:1px solid rgba(25,195,125,.35);
  color:#b8ffe2;font-size:.7rem;padding:2px 8px;border-radius:999px;margin-left:8px;font-weight:900;
}
.msg .msg-text{line-height:1.45;color:var(--text)}
.msg .msg-time{font-size:.75rem;color:var(--muted2);margin-top:6px}
.empty-state{text-align:center;padding:40px;color:var(--muted)}
</style>
</head>
<body>
<div class="container">
  <h1>Review Responses</h1>
  <p class="subtitle">Review guest replies and full conversations</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
  </div>

  <div class="panel" style="margin-bottom:16px">
    <div class="date-bar">
      <div class="filter-group">
        <label style="font-size:.85rem;color:var(--muted)">Date</label>
        <input type="date" id="reviewDate" />
      </div>
      <button onclick="loadReview()">Load</button>
      <span class="muted" id="reviewCount" style="font-size:.9rem"></span>
    </div>
  </div>

  <div id="reviewLoading" class="loading" style="display:none">
    <div class="spinner"></div>
    <p>Loading responses...</p>
  </div>
  <div id="reviewError" class="error" style="display:none"></div>
  <div id="reviewResults"></div>
</div>

<script>
const today = new Date().toISOString().split("T")[0];
document.getElementById("reviewDate").value = today;

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(str, len){
  if(!str) return "";
  return str.length <= len ? str : str.substring(0, len) + "...";
}

async function loadReview(){
  const date = document.getElementById("reviewDate").value;
  const loading = document.getElementById("reviewLoading");
  const error = document.getElementById("reviewError");
  const results = document.getElementById("reviewResults");
  const countEl = document.getElementById("reviewCount");

  loading.style.display = "block";
  error.style.display = "none";
  results.innerHTML = "";
  countEl.textContent = "";

  try{
    const params = new URLSearchParams();
    params.append("startDate", date);
    params.append("endDate", date);
    // Fetch all messages for the date
    const res = await fetch("/api/dashboard/drill?" + params.toString());
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    loading.style.display = "none";
    const allMsgs = data.items || [];

    // Find phones where a Guest replied
    const guestPhones = new Set();
    allMsgs.forEach(function(m){
      if(m.sender === "Guest" && m.phoneNumber) guestPhones.add(m.phoneNumber);
    });

    if(guestPhones.size === 0){
      results.innerHTML = '<div class="empty-state">No guest responses found for ' + escapeHtml(date) + '</div>';
      countEl.textContent = "0 responses";
      return;
    }

    // Group all messages by phone (only phones that had a guest reply)
    const phoneData = {};
    allMsgs.forEach(function(m){
      if(!m.phoneNumber || !guestPhones.has(m.phoneNumber)) return;
      if(!phoneData[m.phoneNumber]) phoneData[m.phoneNumber] = { messages: [], callIds: new Set(), guestMsgCount: 0, latestGuest: null };
      phoneData[m.phoneNumber].messages.push(m);
      if(m.callId) phoneData[m.phoneNumber].callIds.add(m.callId);
      if(m.sender === "Guest"){
        phoneData[m.phoneNumber].guestMsgCount++;
        if(!phoneData[m.phoneNumber].latestGuest || new Date(m.timestamp) > new Date(phoneData[m.phoneNumber].latestGuest.timestamp)){
          phoneData[m.phoneNumber].latestGuest = m;
        }
      }
    });

    // Sort by latest guest reply time descending
    const sortedPhones = Object.keys(phoneData).sort(function(a, b){
      const at = phoneData[a].latestGuest ? new Date(phoneData[a].latestGuest.timestamp).getTime() : 0;
      const bt = phoneData[b].latestGuest ? new Date(phoneData[b].latestGuest.timestamp).getTime() : 0;
      return bt - at;
    });

    countEl.textContent = sortedPhones.length + " guest" + (sortedPhones.length !== 1 ? "s" : "") + " replied";

    let html = "";
    sortedPhones.forEach(function(phone, idx){
      const pd = phoneData[phone];
      const latestMsg = pd.latestGuest;
      const callId = pd.callIds.values().next().value || "";
      const blandUrl = callId ? "https://app.bland.ai/dashboard/sms/" + encodeURIComponent(callId) + "?tab=conversations" : "";

      html += '<div class="resp-card" id="resp_' + idx + '">';
      html += '<div class="resp-header" onclick="toggleResp(' + idx + ')">';
      html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
      html += '<span class="resp-phone">' + escapeHtml(phone) + '</span>';
      html += '<span class="resp-preview">' + escapeHtml(truncate(latestMsg ? latestMsg.message : "", 60)) + '</span>';
      html += '</div>';
      html += '<div class="resp-meta">';
      html += '<span class="chip">' + pd.guestMsgCount + ' repl' + (pd.guestMsgCount !== 1 ? 'ies' : 'y') + '</span>';
      html += '<span class="muted">' + (latestMsg ? escapeHtml(formatTimestamp(latestMsg.timestamp)) : "-") + '</span>';
      html += '<div class="resp-links">';
      if(blandUrl) html += '<a href="' + escapeHtml(blandUrl) + '" target="_blank" class="link-bland" onclick="event.stopPropagation()">Bland SMS</a>';
      html += '<a href="/search?phone=' + encodeURIComponent(phone) + '" target="_blank" class="link-search" onclick="event.stopPropagation()">Full History</a>';
      html += '</div>';
      html += '</div>';
      html += '</div>';

      // Conversation detail
      html += '<div class="resp-convo">';
      var msgs = pd.messages.sort(function(a,b){ return new Date(a.timestamp) - new Date(b.timestamp); });
      msgs.forEach(function(m){
        var isGuest = m.sender === "Guest";
        html += '<div class="msg ' + (isGuest ? "guest" : "ai") + '">';
        html += '<div class="msg-sender">' + escapeHtml(m.sender || "Unknown");
        if(m.nodeTag) html += '<span class="msg-tag">' + escapeHtml(m.nodeTag) + '</span>';
        html += '</div>';
        html += '<div class="msg-text">' + escapeHtml(m.message || "") + '</div>';
        html += '<div class="msg-time">' + escapeHtml(formatTimestamp(m.timestamp)) + '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    });

    results.innerHTML = html;

    // Auto-expand first card
    if(sortedPhones.length > 0){
      document.getElementById("resp_0").classList.add("open");
    }
  } catch(err){
    loading.style.display = "none";
    error.textContent = String(err.message || err);
    error.style.display = "block";
  }
}

function toggleResp(idx){
  document.getElementById("resp_" + idx).classList.toggle("open");
}

loadReview();
</script>
</body>
</html>`;

// -----------------------------
// Network helper: robust fetch (retries on TLS/network)
// -----------------------------
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
): Promise<Response> {
  // Force Connection: close to avoid stale pool connections
  const headers = new Headers(options.headers);
  headers.set("Connection", "close");
  const safeOptions = { ...options, headers };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, safeOptions);
      return response;
    } catch (error: any) {
      const isNetworkError = error?.message?.includes?.("InvalidContentType") ||
        error?.message?.includes?.("connection closed") ||
        error?.message?.includes?.("broken pipe") ||
        error?.name === "TypeError";

      if (isNetworkError && attempt < retries) {
        const timestamp = new Date().toLocaleString("sv-SE", {
          timeZone: "America/New_York",
          timeZoneName: "short",
        });
        console.warn(
          `${timestamp} NETWORK Fetch failed. Attempt ${attempt + 1}/${
            retries + 1
          }: ${error?.message ?? String(error)}. Retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unreachable");
}

// -----------------------------
// Background processor: Process Scheduled Injections
// -----------------------------
async function processScheduledInjections(): Promise<
  { processedCount: number; skippedCount: number }
> {
  const timestamp = new Date().toLocaleString("sv-SE", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  console.log(
    `${timestamp} PROCESSOR Running scheduled injection processor...`,
  );

  try {
    const now = Date.now();
    const entries = kv.list({ prefix: ["scheduledinjection"] });

    let processedCount = 0;
    let skippedCount = 0;

    for await (const entry of entries) {
      const injection = entry.value as any;
      const scheduledTime = new Date(injection.eventTime).getTime();

      if (Number.isFinite(scheduledTime) && scheduledTime <= now) {
        console.log(
          `${timestamp} PROCESSOR Triggering injection for ${injection.phone} scheduled ${injection.eventTime}`,
        );

        try {
          const queueUrl = injection.isTest
            ? "https://conf-omnisource.ngrok.app"
            : "https://conf-deploy.ngrok.app";

          const response = await fetchWithRetry(
            `${queueUrl}/confirmations/v001/sms-callback/bland/talk-now`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phone: injection.phone }),
            },
            2,
          );

          if (response.ok) {
            console.log(
              `${timestamp} PROCESSOR Successfully triggered injection for ${injection.phone}`,
            );
            // Write to injection history before deleting
            const historyKey = [
              "injectionhistory",
              injection.phone,
              new Date().toISOString(),
            ];
            await kv.set(historyKey, {
              phone: injection.phone,
              eventTime: injection.eventTime,
              scheduledAt: injection.scheduledAt,
              isTest: injection.isTest ?? false,
              firedAt: new Date().toISOString(),
              firedBy: "cron",
              status: "success",
              callbackStatus: response.status,
            });
            await kv.delete(entry.key);
            console.log(
              `${timestamp} PROCESSOR Deleted scheduled injection for ${injection.phone}`,
            );
            processedCount++;
          } else {
            const errorText = await response.text().catch(() => "");
            console.error(
              `${timestamp} PROCESSOR Failed to trigger injection for ${injection.phone} (${response.status}): ${errorText}`,
            );
          }
        } catch (error) {
          console.error(
            `${timestamp} PROCESSOR Error processing ${injection.phone}:`,
            error,
          );
        }
      } else {
        skippedCount++;
      }
    }

    console.log(
      `${timestamp} PROCESSOR Batch complete: ${processedCount} triggered, ${skippedCount} pending.`,
    );
    return { processedCount, skippedCount };
  } catch (error) {
    const timestamp2 = new Date().toLocaleString("sv-SE", {
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
    console.error(`${timestamp2} PROCESSOR Fatal error in processor:`, error);
    throw error;
  }
}

console.log(
  "INIT: External cron mode, waiting for /api/cron/trigger requests...",
);

// -----------------------------
// HTTP server
// -----------------------------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const method = req.method;
  const pathname = url.pathname;

  const timestamp = new Date().toLocaleString("sv-SE", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  const requestId = crypto.randomUUID().split("-")[0];

  console.log(
    `${timestamp} [Req:${requestId}] ${method} ${pathname}${url.search}`,
  );
  console.log(`${timestamp} [Req:${requestId}] Full URL: ${req.url}`);
  console.log(`${timestamp} [Req:${requestId}] Pathname: ${pathname}`);

  const headers = new Headers({
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type",
  });

  if (method === "OPTIONS") {
    console.log(`${timestamp} [Req:${requestId}] CORS preflight handled`);
    return new Response(null, { headers });
  }

  try {
    // -----------------------------
    // LEGACY ROOT ENDPOINTS (must stay first for GET /?recordId=...)
    // -----------------------------
    if (
      method === "GET" && pathname === "/" && url.searchParams.has("recordId")
    ) {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED LEGACY with recordId`,
      );
      const rawRecordId = url.searchParams.get("recordId");
      if (!rawRecordId) {
        return new Response(
          JSON.stringify({ error: "Missing recordId param" }),
          {
            status: 400,
            headers,
          },
        );
      }

      const recordId = String(rawRecordId);
      const stage = url.searchParams.get("stage");

      console.log(
        `${timestamp} [Req:${requestId}] Checking KV for ID ${recordId} stage=${
          stage ?? "legacy"
        }`,
      );

      const checked = await checkAuditMarker({ recordId, stage });
      return new Response(
        JSON.stringify({
          exists: checked.exists,
          recordId: checked.recordId,
          stage: checked.stage,
          timestamp: checked.timestamp,
        }),
        { headers },
      );
    }

    if (method === "POST" && pathname === "/") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED LEGACY POST /`);
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers,
        });
      }

      const rawRecordId = body?.recordId;
      if (!rawRecordId) {
        return new Response(
          JSON.stringify({ error: "Missing recordId in body" }),
          {
            status: 400,
            headers,
          },
        );
      }

      const recordId = String(rawRecordId);
      const stage = body.stage ?? url.searchParams.get("stage");
      const claim = parseBool(body.claim ?? url.searchParams.get("claim"));
      const override = parseBool(
        body.override ?? url.searchParams.get("override"),
      );
      const source = body.source ?? "AuditController";
      const meta = body.meta;

      console.log(
        `${timestamp} [Req:${requestId}] Saving ID ${recordId} stage=${
          stage ?? "legacy"
        } claim=${claim} override=${override}`,
      );

      const saved = await saveAuditMarker({
        recordId,
        stage,
        claim,
        override,
        source,
        meta,
      });
      return new Response(JSON.stringify(saved), { headers });
    }

    // -----------------------------
    // UI PAGES
    // -----------------------------
    // Home page at /, but only when NOT using legacy query params
    if (
      method === "GET" && pathname === "/" && !url.searchParams.has("recordId")
    ) {
      console.log(`${timestamp} [Req:${requestId}] MATCHED home UI (/)`);
      return new Response(homePageHtml, {
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (method === "GET" && pathname === "/audit") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED audit UI`);
      return new Response(auditSearchHtml, {
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (method === "GET" && pathname === "/dashboard") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED dashboard UI`);
      return new Response(dashboardHtml, {
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (method === "GET" && pathname === "/search") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED search UI`);
      return new Response(searchPageHtml, {
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (method === "GET" && pathname === "/injections") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED injections UI`);
      return new Response(injectionsPageHtml, {
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (method === "GET" && pathname === "/review") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED review UI`);
      return new Response(reviewPageHtml, {
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    // -----------------------------
    // POST /api/guests/activate
    // Receives SHA-256 hex hashes of 10-digit phone numbers.
    // Scans scheduledinjection entries from the past 7 days,
    // SHA-256 hashes each phone10, and if a match is found in the
    // provided list, writes ["guestactivated", phone10] with Activated: true.
    // -----------------------------
    if (method === "POST" && pathname === "/api/guests/activate") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/guests/activate`,
      );
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers,
        });
      }

      const phones: unknown = body?.phones;
      if (!Array.isArray(phones) || phones.length === 0) {
        return new Response(
          JSON.stringify({
            error:
              'Missing or empty phones array. Expected: { phones: ["sha256hex", ...] }',
          }),
          { status: 400, headers },
        );
      }

      // Build a Set of incoming SHA hashes (lowercased for safe comparison)
      const incomingHashes = new Set<string>();
      for (const p of phones) {
        if (typeof p === "string" && p.length > 0) {
          incomingHashes.add(p.toLowerCase());
        }
      }

      console.log(
        `${timestamp} [Req:${requestId}] Received ${incomingHashes.size} unique SHA hashes to match`,
      );
      // Log first 3 hashes for debugging
      const sampleHashes = [...incomingHashes].slice(0, 3);
      console.log(
        `${timestamp} [Req:${requestId}] ACTIVATE sample incoming hashes: ${
          JSON.stringify(sampleHashes.map((h) => h.substring(0, 16) + "..."))
        }`,
      );
      console.log(
        `${timestamp} [Req:${requestId}] ACTIVATE 7-day cutoff: ${
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }`,
      );

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const iter = kv.list({ prefix: ["scheduledinjection"] });

      let scannedCount = 0;
      let matchedCount = 0;
      let skippedOlderCount = 0;
      const matched: Array<{ phone10: string; eventTime: string }> = [];
      const skippedOlder: Array<
        { phone10: string; eventTime: string; reason: string }
      > = [];
      const checkedNoMatch: Array<{ phone10: string; eventTime: string }> = [];

      for await (const entry of iter) {
        scannedCount++;
        const value = entry.value as any;

        // Extract phone10 from the KV key (["scheduledinjection", phone10])
        const phone10 = typeof entry.key[1] === "string" ? entry.key[1] : null;
        if (!phone10 || phone10.length !== 10) {
          console.log(
            `${timestamp} [Req:${requestId}] ACTIVATE skipping entry with invalid key: ${
              JSON.stringify(entry.key)
            }`,
          );
          continue;
        }

        // Check if the scheduledinjection is within the past 7 days
        const eventTimeRaw = value?.eventTime ?? value?.scheduledAt ??
          value?.timestamp;
        const eventTimeMs = parseDateishToMs(eventTimeRaw);
        if (eventTimeMs == null) {
          console.log(
            `${timestamp} [Req:${requestId}] ACTIVATE skipping phone ${phone10}: no parseable eventTime (raw=${eventTimeRaw})`,
          );
          skippedOlder.push({
            phone10,
            eventTime: String(eventTimeRaw),
            reason: "unparseable eventTime",
          });
          skippedOlderCount++;
          continue;
        }
        if (eventTimeMs < sevenDaysAgo) {
          const eventTimeIso = new Date(eventTimeMs).toISOString();
          console.log(
            `${timestamp} [Req:${requestId}] ACTIVATE skipping phone ${phone10}: eventTime ${eventTimeIso} older than 7 days`,
          );
          skippedOlder.push({
            phone10,
            eventTime: eventTimeIso,
            reason: "older than 7 days",
          });
          skippedOlderCount++;
          continue;
        }

        // SHA-256 the phone10 and check against incoming hashes
        const phoneHash = await sha256Hex(phone10);
        const eventTimeIsoForLog = typeof eventTimeRaw === "string"
          ? eventTimeRaw
          : new Date(eventTimeMs).toISOString();
        console.log(
          `${timestamp} [Req:${requestId}] ACTIVATE checking phone ${phone10} (event=${eventTimeIsoForLog}) hash=${
            phoneHash.substring(0, 12)
          }... against ${incomingHashes.size} incoming hashes`,
        );

        if (incomingHashes.has(phoneHash)) {
          console.log(
            `${timestamp} [Req:${requestId}] ACTIVATE *** MATCH FOUND *** phone=${phone10} hash=${
              phoneHash.substring(0, 16)
            }... marking activated`,
          );

          const activatedValue = {
            phone10,
            Activated: true,
            activatedAt: new Date().toISOString(),
            eventTime: eventTimeIsoForLog,
          };

          await kv.set(guestActivatedKey(phone10), activatedValue);
          matchedCount++;
          matched.push({
            phone10,
            eventTime: activatedValue.eventTime,
          });
        } else {
          console.log(
            `${timestamp} [Req:${requestId}] ACTIVATE no hash match for phone ${phone10} hash=${
              phoneHash.substring(0, 12)
            }...`,
          );
          checkedNoMatch.push({ phone10, eventTime: eventTimeIsoForLog });
        }
      }

      console.log(
        `${timestamp} [Req:${requestId}] Activate scan complete: scanned=${scannedCount} matched=${matchedCount} skippedOlder=${skippedOlderCount} checkedNoMatch=${checkedNoMatch.length}`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          incomingHashCount: incomingHashes.size,
          scannedScheduledInjections: scannedCount,
          matchedCount,
          skippedOlderThan7Days: skippedOlderCount,
          checkedButNoMatch: checkedNoMatch.length,
          matched,
          skippedOlder,
          checkedNoMatch,
        }),
        { headers },
      );
    }

    // -----------------------------
    // POST /api/guests/answered
    // Receives a plain 10-digit phone number via query param ?Phone=XXX or JSON body { phone: "XXX" }.
    // Writes ["guestanswered", phone10] with answered: true.
    // -----------------------------
    if (method === "POST" && pathname === "/api/guests/answered") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/guests/answered`,
      );

      // Try query param first (case-insensitive: Phone, phone, PHONE all work)
      let rawPhone: string | null = url.searchParams.get("Phone") ??
        url.searchParams.get("phone") ?? null;

      // If no query param, try JSON body (only for POST)
      if (!rawPhone && method === "POST") {
        try {
          const body = await req.json();
          rawPhone = body?.phone ?? body?.Phone ?? null;
        } catch {
          // No valid JSON body, that's fine if query param was provided
        }
      }

      console.log(
        `${timestamp} [Req:${requestId}] ANSWERED raw phone input: ${rawPhone}`,
      );

      const phone10 = normalizePhone(rawPhone);
      if (!phone10) {
        return new Response(
          JSON.stringify({
            error:
              'Missing or invalid phone. Use ?Phone=5551234567 or POST body { phone: "5551234567" }',
            received: rawPhone ?? null,
          }),
          { status: 400, headers },
        );
      }

      // Verify this phone actually exists in conversations before marking answered
      const convoIter = kv.list({ prefix: ["conversations", phone10] }, {
        limit: 1,
      });
      let phoneExists = false;
      for await (const _entry of convoIter) {
        phoneExists = true;
      }

      if (!phoneExists) {
        console.log(
          `${timestamp} [Req:${requestId}] ANSWERED phone ${phone10} not found in conversations — skipping`,
        );
        return new Response(
          JSON.stringify({
            success: false,
            phone10,
            error:
              "Phone not found in conversations. Only existing SMS guests can be marked as answered.",
          }),
          { status: 404, headers },
        );
      }

      const answeredValue = {
        phone10,
        answered: true,
        answeredAt: new Date().toISOString(),
      };

      await kv.set(guestAnsweredKey(phone10), answeredValue);

      console.log(
        `${timestamp} [Req:${requestId}] Marked guest as answered: ${phone10}`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          phone10,
          key: guestAnsweredKey(phone10),
          value: answeredValue,
        }),
        { headers },
      );
    }

    // -----------------------------
    // ADDED SALE RECORD ENDPOINT
    // POST /api/sales/record
    // Body: { phone: "15551234567" } (11 digits, starts with 1)
    // -----------------------------
    if (method === "POST" && pathname === "/api/sales/record") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/sales/record`);
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers,
        });
      }

      const parsed = normalizePhone11To10(body?.phone);
      if (!parsed) {
        return new Response(
          JSON.stringify({
            error:
              "Missing/invalid phone: must be 11 digits starting with 1, e.g. 15551234567",
            expected: "15551234567",
            received: body?.phone ?? null,
          }),
          { status: 400, headers },
        );
      }

      const { phone11, phone10 } = parsed;
      const saleAtMs = Date.now();
      const windowDays = 7;

      const appt = await getAppointmentAtForPhone(phone10);
      if (!appt.found || !appt.appointmentAt) {
        return new Response(
          JSON.stringify({
            success: true,
            phone11,
            phone10,
            appointmentFound: false,
            updated: false,
            reason:
              "No appointment record found for this phone or missing eventTime/appointmentAt field",
            appointmentKey: appointmentKey(phone10),
          }),
          { status: 200, headers },
        );
      }

      const appointmentAtMs = parseDateishToMs(appt.appointmentAt);
      if (appointmentAtMs == null) {
        return new Response(
          JSON.stringify({
            success: true,
            phone11,
            phone10,
            appointmentFound: true,
            updated: false,
            reason:
              "Appointment record found but appointmentAt is not a valid date",
            appointmentAt: appt.appointmentAt,
            appointmentKey: appointmentKey(phone10),
          }),
          { status: 200, headers },
        );
      }

      const ok = isWithinWindowAfter(appointmentAtMs, saleAtMs, windowDays);
      if (!ok) {
        return new Response(
          JSON.stringify({
            success: true,
            phone11,
            phone10,
            appointmentFound: true,
            updated: false,
            reason: "Sale is not within 7 days AFTER the appointment time",
            windowDays,
            appointmentAt: new Date(appointmentAtMs).toISOString(),
            saleAt: new Date(saleAtMs).toISOString(),
            saleMarkerKey: saleMarkerKey(phone10),
          }),
          { status: 200, headers },
        );
      }

      const withinDays = Math.floor(
        (saleAtMs - appointmentAtMs) / (24 * 60 * 60 * 1000),
      );
      const marker: SaleWithinWindowMarker = {
        phone10,
        phone11,
        appointmentAt: new Date(appointmentAtMs).toISOString(),
        saleAt: new Date(saleAtMs).toISOString(),
        windowDays,
        withinDays,
        updatedAt: new Date().toISOString(),
        meta: { appointmentKey: appointmentKey(phone10) },
      };

      await kv.set(saleMarkerKey(phone10), marker);

      return new Response(
        JSON.stringify({
          success: true,
          phone11,
          phone10,
          appointmentFound: true,
          updated: true,
          saleMarkerKey: saleMarkerKey(phone10),
          value: marker,
        }),
        { status: 200, headers },
      );
    }

    // -----------------------------
    // AUDIT BROWSE API (paged, optional stage)
    // GET /api/audit/browse
    // -----------------------------
    if (method === "GET" && pathname === "/api/audit/browse") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/audit/browse`);

      const startDateParam = url.searchParams.get("startDate");
      const endDateParam = url.searchParams.get("endDate");
      const recordIdFilter = url.searchParams.get("recordId");
      const stageParam = url.searchParams.get("stage");
      const stage = sanitizeStage(stageParam) ?? null;

      const startDate = startDateParam
        ? new Date(`${startDateParam}T00:00:00-04:00`)
        : null;
      const endDate = endDateParam
        ? new Date(`${endDateParam}T23:59:59-04:00`)
        : null;

      const page = clampInt(url.searchParams.get("page"), 1, 10000, 1);
      const pageSize = clampInt(url.searchParams.get("pageSize"), 1, 200, 50);

      console.log(
        `${timestamp} [Req:${requestId}] Audit browse filters start=${startDateParam} end=${endDateParam} recordId=${recordIdFilter} stage=${
          stage ?? "legacy"
        } page=${page} pageSize=${pageSize}`,
      );

      const records: any[] = [];
      const iter = stage
        ? kv.list({ prefix: ["auditstage", stage] })
        : kv.list({ prefix: ["audit"] });

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      let todayCount = 0;
      let latestTimestamp: string | null = null;

      for await (const entry of iter) {
        const value = entry.value as any;
        const recordId = stage
          ? (entry.key[2] as string)
          : (entry.key[1] as string);
        const processedAt = value?.processedAt;

        if (recordIdFilter && !recordId.includes(recordIdFilter)) continue;

        if (processedAt && (startDate || endDate)) {
          const entryDate = new Date(processedAt);
          if (startDate && entryDate < startDate) continue;
          if (endDate && entryDate > endDate) continue;
        }

        if (processedAt) {
          const entryDate = new Date(processedAt);
          if (entryDate >= todayStart) todayCount++;
          if (!latestTimestamp || processedAt > latestTimestamp) {
            latestTimestamp = processedAt;
          }
        }

        records.push({
          recordId,
          processedAt: value?.processedAt ?? null,
          source: value?.source ?? "AuditController",
        });
      }

      records.sort((a, b) => {
        const at = a.processedAt
          ? new Date(a.processedAt).getTime()
          : -Infinity;
        const bt = b.processedAt
          ? new Date(b.processedAt).getTime()
          : -Infinity;
        return bt - at;
      });

      const total = records.length;
      const startIdx = (page - 1) * pageSize;
      const pageRecords = records.slice(startIdx, startIdx + pageSize);

      console.log(
        `${timestamp} [Req:${requestId}] Found ${total} audit records, returning ${pageRecords.length} for page ${page}`,
      );

      return new Response(
        JSON.stringify({
          records: pageRecords,
          total,
          todayCount,
          latest: latestTimestamp,
          page,
          pageSize,
          stage,
        }),
        { headers },
      );
    }

    // -----------------------------
    // DASHBOARD STATS API
    // GET /api/dashboard/stats
    // Now also counts guestactivated and guestanswered entries.
    // -----------------------------
    if (method === "GET" && pathname === "/api/dashboard/stats") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/dashboard/stats`,
      );

      const startDateParam = url.searchParams.get("startDate");
      const endDateParam = url.searchParams.get("endDate");
      const prefixFilter = url.searchParams.get("prefix");

      const startDate = startDateParam
        ? new Date(`${startDateParam}T00:00:00-04:00`)
        : null;
      const endDate = endDateParam
        ? new Date(`${endDateParam}T23:59:59-04:00`)
        : null;

      console.log(
        `${timestamp} [Req:${requestId}] Filters start=${startDateParam} end=${endDateParam} prefix=${prefixFilter}`,
      );

      const allEntries: any[] = [];
      const kvBreakdown: Record<
        string,
        { count: number; latest: string | null }
      > = {};

      const prefixesToScan = prefixFilter
        ? [[prefixFilter]]
        : [["conversations"], ["scheduledinjection"], ["smsflowcontext"]];

      console.log(
        `${timestamp} [Req:${requestId}] Scanning ${prefixesToScan.length} prefixes...`,
      );

      for (const prefix of prefixesToScan) {
        const iter = kv.list({ prefix });
        const prefixName = prefix[0] as string;
        if (!kvBreakdown[prefixName]) {
          kvBreakdown[prefixName] = { count: 0, latest: null };
        }

        for await (const entry of iter) {
          const value = entry.value as any;

          let entryTimestamp: string | null = null;
          if (value?.timestamp) entryTimestamp = value.timestamp;
          else if (value?.processedAt) entryTimestamp = value.processedAt;
          else if (value?.scheduledAt) entryTimestamp = value.scheduledAt;
          else if (value?.createdAt) entryTimestamp = value.createdAt;
          else if (Array.isArray(entry.key) && entry.key.length === 4) {
            const possibleTs = entry.key[3];
            if (typeof possibleTs === "string" && possibleTs.includes("T")) {
              entryTimestamp = possibleTs;
            }
          }

          if (entryTimestamp && (startDate || endDate)) {
            const entryDate = new Date(entryTimestamp);
            if (startDate && entryDate < startDate) continue;
            if (endDate && entryDate > endDate) continue;
          }

          kvBreakdown[prefixName].count++;
          if (entryTimestamp) {
            if (!kvBreakdown[prefixName].latest) {
              kvBreakdown[prefixName].latest = entryTimestamp;
            }
            if (kvBreakdown[prefixName].latest! < entryTimestamp) {
              kvBreakdown[prefixName].latest = entryTimestamp;
            }
          }

          allEntries.push({
            key: entry.key,
            value: entry.value,
            timestamp: entryTimestamp,
          });
        }
      }

      console.log(
        `${timestamp} [Req:${requestId}] Found ${allEntries.length} total entries`,
      );

      const conversationEntries = allEntries.filter((e) =>
        Array.isArray(e.key) && e.key[0] === "conversations"
      );
      console.log(
        `${timestamp} [Req:${requestId}] Found ${conversationEntries.length} conversation entries`,
      );

      const textsSent = conversationEntries.filter((e) =>
        e.value?.sender === "AI Bot"
      ).length;
      const initialTextsPhones = new Set(
        conversationEntries.filter((e) => {
          if (e.value?.sender !== "AI Bot") return false;
          const message = typeof e.value?.message === "string"
            ? e.value.message.trimStart()
            : "";
          return message.startsWith("Hey ") || message.startsWith("hey ");
        }).map((e) => e.value?.phoneNumber),
      );
      const initialTextsSent = initialTextsPhones.size;
      const uniquePhonesSent = new Set(
        conversationEntries
          .filter((e) => e.value?.sender === "AI Bot")
          .map((e) => e.value?.phoneNumber),
      ).size;

      const phonesWithReplies = new Set(
        conversationEntries
          .filter((e) => e.value?.sender === "Guest")
          .map((e) => e.value?.phoneNumber),
      );
      const peopleReplied = phonesWithReplies.size;

      const appointmentsSet = new Set(
        conversationEntries
          .filter((e) => isAppointmentMatch(e.value))
          .map((e) => e.value?.phoneNumber),
      ).size;

      const recentEntries = allEntries
        .filter((e) => e.timestamp)
        .sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
        .slice(0, 50);

      const totalKvEntries = Object.values(kvBreakdown).reduce(
        (sum, b) => sum + (b.count || 0),
        0,
      );

      // Count guestactivated entries (date-filtered by activatedAt)
      let activatedCount = 0;
      const activatedIter = kv.list({ prefix: ["guestactivated"] });
      for await (const entry of activatedIter) {
        const v = entry.value as any;
        const at = v?.activatedAt ? new Date(v.activatedAt) : null;
        if (startDate && at && at < startDate) continue;
        if (endDate && at && at > endDate) continue;
        activatedCount++;
      }

      // Count guestanswered entries (date-filtered by answeredAt)
      let answeredCount = 0;
      const answeredIter = kv.list({ prefix: ["guestanswered"] });
      for await (const entry of answeredIter) {
        const v = entry.value as any;
        const at = v?.answeredAt ? new Date(v.answeredAt) : null;
        if (startDate && at && at < startDate) continue;
        if (endDate && at && at > endDate) continue;
        answeredCount++;
      }

      console.log(
        `${timestamp} [Req:${requestId}] Stats textsSent=${textsSent} uniquePhones=${uniquePhonesSent} replied=${peopleReplied} appointments=${appointmentsSet} totalKV=${totalKvEntries} activated=${activatedCount} answered=${answeredCount}`,
      );

      return new Response(
        JSON.stringify({
          stats: {
            textsSent,
            initialTextsSent,
            uniquePhonesSent,
            peopleReplied,
            appointmentsSet,
            totalKvEntries,
            activatedCount,
            answeredCount,
          },
          kvBreakdown,
          recentEntries,
        }),
        { headers },
      );
    }

    // -----------------------------
    // DASHBOARD DRILL-IN API
    // GET /api/dashboard/drill?startDate&endDate&sender
    // Returns conversation entries filtered by date and sender
    // -----------------------------
    if (method === "GET" && pathname === "/api/dashboard/drill") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/dashboard/drill`,
      );

      const startDateParam = url.searchParams.get("startDate");
      const endDateParam = url.searchParams.get("endDate");
      const senderFilter = url.searchParams.get("sender") ?? "";

      const startDate = startDateParam
        ? new Date(`${startDateParam}T00:00:00-04:00`)
        : null;
      const endDate = endDateParam
        ? new Date(`${endDateParam}T23:59:59-04:00`)
        : null;

      console.log(
        `${timestamp} [Req:${requestId}] Drill filters start=${startDateParam} end=${endDateParam} sender=${senderFilter}`,
      );

      const items: any[] = [];
      const iter = kv.list({ prefix: ["conversations"] });

      for await (const entry of iter) {
        const value = entry.value as any;

        let entryTimestamp: string | null = null;
        if (value?.timestamp) entryTimestamp = value.timestamp;
        else if (value?.processedAt) entryTimestamp = value.processedAt;
        else if (value?.scheduledAt) entryTimestamp = value.scheduledAt;
        else if (value?.createdAt) entryTimestamp = value.createdAt;
        else if (Array.isArray(entry.key) && entry.key.length === 4) {
          const possibleTs = entry.key[3];
          if (typeof possibleTs === "string" && possibleTs.includes("T")) {
            entryTimestamp = possibleTs;
          }
        }

        if (entryTimestamp && (startDate || endDate)) {
          const entryDate = new Date(entryTimestamp);
          if (startDate && entryDate < startDate) continue;
          if (endDate && entryDate > endDate) continue;
        }

        if (senderFilter && String(value?.sender ?? "") !== senderFilter) {
          continue;
        }

        items.push({
          phoneNumber: value?.phoneNumber ?? null,
          callId: value?.callId ?? null,
          sender: value?.sender ?? null,
          nodeTag: value?.nodeTag ?? null,
          message: value?.message ?? null,
          timestamp: entryTimestamp,
        });

        if (items.length >= 500) break;
      }

      items.sort((a, b) => {
        const at = a.timestamp ? new Date(a.timestamp).getTime() : -Infinity;
        const bt = b.timestamp ? new Date(b.timestamp).getTime() : -Infinity;
        return bt - at;
      });

      console.log(
        `${timestamp} [Req:${requestId}] Drill returning ${items.length} items`,
      );

      return new Response(
        JSON.stringify({ items, count: items.length }),
        { headers },
      );
    }

    // -----------------------------
    // APPOINTMENTS DRILL-IN API
    // GET /api/appointments
    // -----------------------------
    if (method === "GET" && pathname === "/api/appointments") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/appointments`);

      const startDateParam = url.searchParams.get("startDate");
      const endDateParam = url.searchParams.get("endDate");
      const prefixFilter = url.searchParams.get("prefix") ?? "conversations";
      const prefix = prefixFilter ? [prefixFilter] : ["conversations"];

      const startDate = startDateParam
        ? new Date(`${startDateParam}T00:00:00-04:00`)
        : null;
      const endDate = endDateParam
        ? new Date(`${endDateParam}T23:59:59-04:00`)
        : null;

      const page = clampInt(url.searchParams.get("page"), 1, 10000, 1);
      const pageSize = clampInt(url.searchParams.get("pageSize"), 1, 200, 50);

      const matches: Array<{
        timestamp: string | null;
        phoneNumber: string | null;
        callId: string | null;
        sender: string | null;
        nodeTag: string | null;
        message: string | null;
        scheduledFor: string | null;
        key: Deno.KvKey;
      }> = [];

      // Collect unique phones to batch-lookup scheduledinjection eventTimes
      const phoneToEventTime = new Map<string, string | null>();

      const iter = kv.list({ prefix });

      for await (const entry of iter) {
        const value = entry.value as any;

        let entryTimestamp: string | null = null;
        if (value?.timestamp) entryTimestamp = value.timestamp;
        else if (value?.processedAt) entryTimestamp = value.processedAt;
        else if (value?.scheduledAt) entryTimestamp = value.scheduledAt;
        else if (value?.createdAt) entryTimestamp = value.createdAt;
        else if (Array.isArray(entry.key) && entry.key.length === 4) {
          const possibleTs = entry.key[3];
          if (typeof possibleTs === "string" && possibleTs.includes("T")) {
            entryTimestamp = possibleTs;
          }
        }

        if ((startDate || endDate) && entryTimestamp) {
          if (!withinOptionalDateRange(entryTimestamp, startDate, endDate)) {
            continue;
          }
        } else if ((startDate || endDate) && !entryTimestamp) {
          continue;
        }

        if (!isAppointmentMatch(value)) continue;

        const phone10 = normalizePhone(value?.phoneNumber);
        if (phone10 && !phoneToEventTime.has(phone10)) {
          phoneToEventTime.set(phone10, null); // placeholder, will fill below
        }

        matches.push({
          timestamp: entryTimestamp,
          phoneNumber: typeof value?.phoneNumber === "string"
            ? value.phoneNumber
            : null,
          callId: typeof value?.callId === "string" ? value.callId : null,
          sender: typeof value?.sender === "string" ? value.sender : null,
          nodeTag: typeof value?.nodeTag === "string" ? value.nodeTag : null,
          message: typeof value?.message === "string" ? value.message : null,
          scheduledFor: null, // will fill after lookup
          key: entry.key,
        });
      }

      // Batch lookup scheduledinjection eventTimes for all unique phones
      for (const phone10 of phoneToEventTime.keys()) {
        const apptResult = await kv.get(["scheduledinjection", phone10]);
        if (apptResult.value) {
          const v = apptResult.value as any;
          const eventTime = v?.eventTime ?? v?.appointmentAt ??
            v?.scheduledAt ?? null;
          phoneToEventTime.set(phone10, eventTime);
        }
      }

      // Backfill scheduledFor on matches
      // First: try scheduledinjection KV entry
      // Fallback: parse "Appointment Scheduled: <date>" from message text in this phone's matches
      for (const m of matches) {
        const phone10 = normalizePhone(m.phoneNumber);
        if (
          phone10 && phoneToEventTime.has(phone10) &&
          phoneToEventTime.get(phone10)
        ) {
          m.scheduledFor = phoneToEventTime.get(phone10) ?? null;
        }
      }

      // Second pass: for matches still missing scheduledFor, try to parse from message text
      // Look across ALL matches for the same phone to find "Appointment Scheduled: ..."
      const phoneToMessageTime = new Map<string, string | null>();
      for (const m of matches) {
        const phone10 = normalizePhone(m.phoneNumber);
        if (!phone10 || phoneToMessageTime.has(phone10)) continue;
        // Look for "Appointment Scheduled: <date string>" in this phone's messages
        const phoneMatches = matches.filter(
          (x) => normalizePhone(x.phoneNumber) === phone10,
        );
        for (const pm of phoneMatches) {
          if (!pm.message) continue;
          const apptMatch = pm.message.match(
            /Appointment Scheduled:\s*(.+)/i,
          );
          if (apptMatch && apptMatch[1]) {
            const parsedDate = new Date(apptMatch[1].trim());
            if (!isNaN(parsedDate.getTime())) {
              phoneToMessageTime.set(phone10, parsedDate.toISOString());
              break;
            }
          }
        }
        if (!phoneToMessageTime.has(phone10)) {
          phoneToMessageTime.set(phone10, null);
        }
      }

      // Apply message-parsed times as fallback
      for (const m of matches) {
        if (m.scheduledFor) continue;
        const phone10 = normalizePhone(m.phoneNumber);
        if (phone10 && phoneToMessageTime.get(phone10)) {
          m.scheduledFor = phoneToMessageTime.get(phone10) ?? null;
        }
      }

      matches.sort((a, b) => {
        const at = a.timestamp ? new Date(a.timestamp).getTime() : -Infinity;
        const bt = b.timestamp ? new Date(b.timestamp).getTime() : -Infinity;
        return bt - at;
      });

      const total = matches.length;
      const startIdx = (page - 1) * pageSize;
      const items = matches.slice(startIdx, startIdx + pageSize);

      return new Response(
        JSON.stringify({
          items,
          total,
          page,
          pageSize,
          filters: {
            startDate: startDateParam ?? null,
            endDate: endDateParam ?? null,
            prefix: prefixFilter ?? null,
            keywords: appointmentKeywords,
          },
        }),
        { headers },
      );
    }

    // -----------------------------
    // CONVERSATION SEARCH API legacy
    // GET /api/conversations/search
    // -----------------------------
    if (method === "GET" && pathname === "/api/conversations/search") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/conversations/search`,
      );

      const phoneParam = url.searchParams.get("phone");
      if (!phoneParam) {
        console.log(`${timestamp} [Req:${requestId}] Missing phone param`);
        return new Response(JSON.stringify({ error: "Missing phone param" }), {
          status: 400,
          headers,
        });
      }

      const phone = phoneParam.replace(/\D/g, "").slice(-10);
      console.log(
        `${timestamp} [Req:${requestId}] Searching conversations for phone...`,
      );

      const results: any[] = [];
      const iter = kv.list({ prefix: ["conversations", phone] });
      for await (const entry of iter) results.push(entry.value);

      const optedOut = results.some((msg: any) => msg?.doNotText === true);

      console.log(
        `${timestamp} [Req:${requestId}] Found ${results.length} messages for phone`,
      );
      return new Response(
        JSON.stringify({
          phone,
          optedOut,
          conversations: results,
          count: results.length,
        }),
        { headers },
      );
    }

    // -----------------------------
    // CONVERSATION SEARCH API improved filters
    // GET /api/conversations/search2
    // -----------------------------
    if (method === "GET" && pathname === "/api/conversations/search2") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/conversations/search2`,
      );

      const phone = normalizePhone(url.searchParams.get("phone"));
      if (!phone) {
        return new Response(
          JSON.stringify({
            error: "Missing/invalid phone (10 digits required)",
          }),
          { status: 400, headers },
        );
      }

      const callIdFilter = url.searchParams.get("callId")?.trim() ?? "";
      const senderFilter = url.searchParams.get("sender")?.trim() ?? "";
      const nodeTagFilter = url.searchParams.get("nodeTag")?.trim() ?? "";
      const containsFilter = url.searchParams.get("contains")?.trim() ?? "";
      const limit = clampInt(url.searchParams.get("limit"), 1, 2000, 2000);

      console.log(
        `${timestamp} [Req:${requestId}] search2 phone=${phone} callId=${callIdFilter} sender=${senderFilter} nodeTag=${nodeTagFilter} contains=${containsFilter} limit=${limit}`,
      );

      const results: any[] = [];
      const iter = kv.list({ prefix: ["conversations", phone] });
      let optedOut = false;

      for await (const entry of iter) {
        const msg = entry.value as any;
        if (msg?.doNotText === true) optedOut = true;

        if (callIdFilter) {
          if (typeof msg?.callId === "string") {
            if (!msg.callId.includes(callIdFilter)) continue;
          } else continue;
        }

        if (senderFilter) {
          if (String(msg?.sender ?? "") !== senderFilter) continue;
        }

        if (nodeTagFilter) {
          const nt = String(msg?.nodeTag ?? "");
          if (!nt || !nt.toLowerCase().includes(nodeTagFilter.toLowerCase())) {
            continue;
          }
        }

        if (containsFilter) {
          const m = String(msg?.message ?? "");
          if (!m || !m.toLowerCase().includes(containsFilter.toLowerCase())) {
            continue;
          }
        }

        results.push(msg);
        if (results.length >= limit) break;
      }

      return new Response(
        JSON.stringify({
          phone,
          optedOut,
          conversations: results,
          count: results.length,
          filters: {
            callId: callIdFilter || null,
            sender: senderFilter || null,
            nodeTag: nodeTagFilter || null,
            contains: containsFilter || null,
            limit,
          },
        }),
        { headers },
      );
    }

    // -----------------------------
    // CRON TRIGGER ENDPOINT
    // GET/POST /api/cron/trigger
    // -----------------------------
    if (
      (method === "GET" || method === "POST") &&
      pathname === "/api/cron/trigger"
    ) {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/cron/trigger (external cron)`,
      );

      try {
        const result = await processScheduledInjections();
        console.log(`${timestamp} [Req:${requestId}] Cron trigger completed`);

        return new Response(
          JSON.stringify({
            success: true,
            timestamp: new Date().toISOString(),
            processed: result.processedCount,
            pending: result.skippedCount,
          }),
          { headers },
        );
      } catch (error: any) {
        console.error(
          `${timestamp} [Req:${requestId}] Cron trigger failed:`,
          error,
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: error?.message ?? String(error),
          }),
          { status: 500, headers },
        );
      }
    }

    // -----------------------------
    // GET /api/cron/trigger-single?phone=XXXXXXXXXX
    // Immediately fires the injection for a single phone, regardless of eventTime.
    // Deletes the scheduledinjection entry on success.
    // -----------------------------
    if (method === "GET" && pathname === "/api/cron/trigger-single") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/cron/trigger-single`,
      );

      const phone = url.searchParams.get("phone");
      if (!phone) {
        return new Response(JSON.stringify({ error: "Missing phone param" }), {
          status: 400,
          headers,
        });
      }

      const phone10 = normalizePhone(phone);
      if (!phone10) {
        return new Response(
          JSON.stringify({
            error: "Invalid phone. Must be 10 digits.",
            received: phone,
          }),
          { status: 400, headers },
        );
      }

      // Look up the injection
      const kvResult = await kv.get(["scheduledinjection", phone10]);
      if (!kvResult.value) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "No scheduled injection found for " + phone10,
          }),
          { status: 404, headers },
        );
      }

      const injection = kvResult.value as any;
      console.log(
        `${timestamp} [Req:${requestId}] TRIGGER-SINGLE ========================================`,
      );
      console.log(
        `${timestamp} [Req:${requestId}] TRIGGER-SINGLE Phone: ${phone10}`,
      );
      console.log(
        `${timestamp} [Req:${requestId}] TRIGGER-SINGLE KV entry found: ${
          JSON.stringify(injection)
        }`,
      );
      console.log(
        `${timestamp} [Req:${requestId}] TRIGGER-SINGLE eventTime: ${injection.eventTime}`,
      );
      console.log(
        `${timestamp} [Req:${requestId}] TRIGGER-SINGLE scheduledAt: ${injection.scheduledAt}`,
      );
      console.log(
        `${timestamp} [Req:${requestId}] TRIGGER-SINGLE isTest: ${injection.isTest}`,
      );

      try {
        const queueUrl = injection.isTest
          ? "https://conf-omnisource.ngrok.app"
          : "https://conf-deploy.ngrok.app";

        const callbackUrl =
          `${queueUrl}/confirmations/v001/sms-callback/bland/talk-now`;
        const callbackBody = { phone: injection.phone ?? phone10 };

        console.log(
          `${timestamp} [Req:${requestId}] TRIGGER-SINGLE POSTing to: ${callbackUrl}`,
        );
        console.log(
          `${timestamp} [Req:${requestId}] TRIGGER-SINGLE POST body: ${
            JSON.stringify(callbackBody)
          }`,
        );

        const response = await fetchWithRetry(
          callbackUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(callbackBody),
          },
          2,
        );

        console.log(
          `${timestamp} [Req:${requestId}] TRIGGER-SINGLE Response status: ${response.status}`,
        );

        if (response.ok) {
          const responseText = await response.text().catch(() => "");
          console.log(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE Response body: ${
              responseText.substring(0, 500)
            }`,
          );
          // Write to injection history before deleting
          const historyKey = [
            "injectionhistory",
            phone10,
            new Date().toISOString(),
          ];
          await kv.set(historyKey, {
            phone: phone10,
            eventTime: injection.eventTime,
            scheduledAt: injection.scheduledAt,
            isTest: injection.isTest ?? false,
            firedAt: new Date().toISOString(),
            firedBy: "manual",
            status: "success",
            callbackStatus: response.status,
          });
          console.log(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE Deleting KV entry ["scheduledinjection", "${phone10}"]...`,
          );
          await kv.delete(["scheduledinjection", phone10]);
          console.log(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE KV entry deleted successfully`,
          );
          console.log(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE ======== COMPLETE (SUCCESS) ========`,
          );

          return new Response(
            JSON.stringify({
              success: true,
              phone: phone10,
              message: "Injection triggered and KV entry deleted",
              eventTime: injection.eventTime,
              isTest: injection.isTest ?? false,
              callbackUrl,
              callbackStatus: response.status,
            }),
            { headers },
          );
        } else {
          const errorText = await response.text().catch(() => "");
          console.error(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE Callback FAILED`,
          );
          console.error(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE Status: ${response.status}`,
          );
          console.error(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE Response: ${
              errorText.substring(0, 500)
            }`,
          );
          console.error(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE KV entry NOT deleted (injection still pending)`,
          );
          console.log(
            `${timestamp} [Req:${requestId}] TRIGGER-SINGLE ======== COMPLETE (FAILED) ========`,
          );

          return new Response(
            JSON.stringify({
              success: false,
              error: `Callback failed (${response.status})`,
              detail: errorText,
              callbackUrl,
            }),
            { status: 502, headers },
          );
        }
      } catch (error: any) {
        console.error(
          `${timestamp} [Req:${requestId}] TRIGGER-SINGLE EXCEPTION: ${
            error?.message ?? String(error)
          }`,
        );
        console.error(
          `${timestamp} [Req:${requestId}] TRIGGER-SINGLE Stack:`,
          error?.stack,
        );
        console.log(
          `${timestamp} [Req:${requestId}] TRIGGER-SINGLE ======== COMPLETE (ERROR) ========`,
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: error?.message ?? String(error),
          }),
          { status: 500, headers },
        );
      }
    }

    // -----------------------------
    // GET /api/audit/status
    // -----------------------------
    if (method === "GET" && pathname === "/api/audit/status") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/audit/status`);

      const rawRecordId = url.searchParams.get("recordId");
      if (!rawRecordId) {
        return new Response(
          JSON.stringify({ error: "Missing recordId param" }),
          {
            status: 400,
            headers,
          },
        );
      }

      const recordId = String(rawRecordId);
      const legacy = await kv.get(auditKey(recordId));
      const landing = await kv.get(auditStageKey("landing", recordId));
      const live = await kv.get(auditStageKey("live", recordId));

      return new Response(
        JSON.stringify({
          recordId,
          legacyExists: legacy.value != null,
          landingExists: landing.value != null,
          liveExists: live.value != null,
          legacyTimestamp: legacy.value
            ? (legacy.value as any).processedAt ?? null
            : null,
          landingTimestamp: landing.value
            ? (landing.value as any).processedAt ?? null
            : null,
          liveTimestamp: live.value
            ? (live.value as any).processedAt ?? null
            : null,
        }),
        { headers },
      );
    }

    // -----------------------------
    // POST /api/audit/save
    // -----------------------------
    if (method === "POST" && pathname === "/api/audit/save") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/audit/save`);

      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers,
        });
      }

      const rawRecordId = body?.recordId;
      if (!rawRecordId) {
        return new Response(
          JSON.stringify({ error: "Missing recordId in body" }),
          {
            status: 400,
            headers,
          },
        );
      }

      const recordId = String(rawRecordId);
      const stage = body.stage ?? url.searchParams.get("stage");
      const claim = parseBool(body.claim ?? url.searchParams.get("claim"));
      const override = parseBool(
        body.override ?? url.searchParams.get("override"),
      );
      const source = body.source ?? "AuditController";
      const meta = body.meta;

      console.log(
        `${timestamp} [Req:${requestId}] Saving ID ${recordId} stage=${
          stage ?? "legacy"
        } claim=${claim} override=${override}`,
      );

      const saved = await saveAuditMarker({
        recordId,
        stage,
        claim,
        override,
        source,
        meta,
      });
      return new Response(JSON.stringify(saved), { headers });
    }

    // -----------------------------
    // GET /api/state
    // -----------------------------
    if (method === "GET" && pathname === "/api/state") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/state`);
      const kvResult = await kv.get(["config", "state"]);
      const state = kvResult.value ?? { partnerStoreRedFlag: true };
      return new Response(JSON.stringify(state), { headers });
    }

    // -----------------------------
    // POST /api/sms/count
    // Returns today's SMS count. Requires body { test: "bW9uc3Rlci1zbXMtY291bnQtMjAyNg==" }
    // -----------------------------
    if (method === "POST" && pathname === "/api/sms/count") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/sms/count`);

      try {
        const body = await req.json();
        if (body?.test !== "bW9uc3Rlci1zbXMtY291bnQtMjAyNg==") {
          console.log(
            `${timestamp} [Req:${requestId}] SMS count: invalid token`,
          );
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers,
          });
        }
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers,
        });
      }

      // Count today's initial texts (unique phones, message starts with "Hey ")
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const todayStart = new Date(`${todayStr}T00:00:00-04:00`);
      const todayEnd = new Date(`${todayStr}T23:59:59-04:00`);

      let totalTexts = 0;
      const initialPhones = new Set<string>();
      const iter = kv.list({ prefix: ["conversations"] });

      for await (const entry of iter) {
        const v = entry.value as any;
        let ts: string | null = v?.timestamp ?? null;
        if (!ts && Array.isArray(entry.key) && entry.key.length === 4) {
          const k3 = entry.key[3];
          if (typeof k3 === "string" && k3.includes("T")) ts = k3;
        }
        if (!ts) continue;
        const d = new Date(ts);
        if (d < todayStart || d > todayEnd) continue;
        if (v?.sender !== "AI Bot") continue;

        totalTexts++;
        const msg = typeof v?.message === "string" ? v.message.trimStart() : "";
        if (msg.startsWith("Hey ") || msg.startsWith("hey ")) {
          const phone = normalizePhone(v?.phoneNumber);
          if (phone) initialPhones.add(phone);
        }
      }

      console.log(
        `${timestamp} [Req:${requestId}] SMS count: totalTexts=${totalTexts} initialTexts=${initialPhones.size}`,
      );

      return new Response(
        JSON.stringify({
          date: todayStr,
          totalTextsSent: totalTexts,
          initialTextsSent: initialPhones.size,
        }),
        { headers },
      );
    }

    // -----------------------------
    // GET /api/audit/check
    // -----------------------------
    if (method === "GET" && pathname === "/api/audit/check") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/audit/check`);

      const rawRecordId = url.searchParams.get("recordId");
      if (!rawRecordId) {
        return new Response(
          JSON.stringify({ error: "Missing recordId param" }),
          {
            status: 400,
            headers,
          },
        );
      }

      const recordId = String(rawRecordId);
      const stage = url.searchParams.get("stage");

      const checked = await checkAuditMarker({ recordId, stage });
      return new Response(
        JSON.stringify({
          exists: checked.exists,
          recordId: checked.recordId,
          stage: checked.stage,
          timestamp: checked.timestamp,
        }),
        { headers },
      );
    }

    // -----------------------------
    // KV endpoints
    // -----------------------------
    if (method === "GET" && pathname === "/api/kv/get") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/kv/get`);
      const keyParam = url.searchParams.get("key");
      if (!keyParam) {
        return new Response(JSON.stringify({ error: "Missing key param" }), {
          status: 400,
          headers,
        });
      }
      let key: any;
      try {
        key = JSON.parse(keyParam);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid key format" }), {
          status: 400,
          headers,
        });
      }
      const result = await kv.get(key);
      return new Response(
        JSON.stringify({
          value: result.value,
          versionstamp: result.versionstamp,
        }),
        {
          headers,
        },
      );
    }

    if (method === "POST" && pathname === "/api/kv/set") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/kv/set`);
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers,
        });
      }

      const { key, value, expireIn } = body ?? {};
      if (!key) {
        return new Response(JSON.stringify({ error: "Missing key in body" }), {
          status: 400,
          headers,
        });
      }

      const options = expireIn ? { expireIn } : undefined;
      await kv.set(key, value, options);
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (method === "DELETE" && pathname === "/api/kv/delete") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/kv/delete`);
      const keyParam = url.searchParams.get("key");
      if (!keyParam) {
        return new Response(JSON.stringify({ error: "Missing key param" }), {
          status: 400,
          headers,
        });
      }
      let key: any;
      try {
        key = JSON.parse(keyParam);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid key format" }), {
          status: 400,
          headers,
        });
      }
      await kv.delete(key);
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (method === "POST" && pathname === "/api/kv/list") {
      console.log(`${timestamp} [Req:${requestId}] MATCHED /api/kv/list`);
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers,
        });
      }

      const { prefix, limit } = body ?? {};
      if (!prefix) {
        return new Response(
          JSON.stringify({ error: "Missing prefix in body" }),
          {
            status: 400,
            headers,
          },
        );
      }

      const results: any[] = [];
      const iter = kv.list({ prefix }, { limit: limit ?? 100 });
      for await (const entry of iter) {
        results.push({
          key: entry.key,
          value: entry.value,
          versionstamp: entry.versionstamp,
        });
      }

      return new Response(JSON.stringify({ entries: results }), { headers });
    }

    // -----------------------------
    // Injection schedule endpoints
    // -----------------------------
    if (method === "POST" && pathname === "/api/injection/schedule") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/injection/schedule`,
      );
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers,
        });
      }

      const { phone, eventTime, isTest } = body ?? {};
      if (!phone || !eventTime) {
        return new Response(
          JSON.stringify({ error: "Missing phone or eventTime in body" }),
          {
            status: 400,
            headers,
          },
        );
      }

      await kv.set(["scheduledinjection", phone], {
        phone,
        eventTime,
        isTest: isTest ?? false,
        scheduledAt: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true, phone, eventTime }), {
        headers,
      });
    }

    if (method === "DELETE" && pathname === "/api/injection/cancel") {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/injection/cancel`,
      );
      const phone = url.searchParams.get("phone");
      if (!phone) {
        return new Response(JSON.stringify({ error: "Missing phone param" }), {
          status: 400,
          headers,
        });
      }
      await kv.delete(["scheduledinjection", phone]);
      return new Response(JSON.stringify({ success: true, phone }), {
        headers,
      });
    }

    // -----------------------------
    // POST|GET /api/report/nightly
    // Sends a daily summary email via Postmark with dashboard stats + CSV of all conversations.
    // Requires env var: POSTMARK_SERVER
    // Uses ServerClient from #postmark (same pattern as other projects).
    // -----------------------------
    if (
      (method === "GET" || method === "POST") &&
      pathname === "/api/report/nightly"
    ) {
      console.log(
        `${timestamp} [Req:${requestId}] MATCHED /api/report/nightly`,
      );

      const postmarkServerToken = Deno.env.get("POSTMARK_SERVER");

      if (!postmarkServerToken) {
        console.log(
          `${timestamp} [Req:${requestId}] REPORT missing env var POSTMARK_SERVER`,
        );
        return new Response(
          JSON.stringify({
            error: "Missing required environment variable: POSTMARK_SERVER",
          }),
          { status: 500, headers },
        );
      }

      const fromEmail = "notifications@monsterrg.com";
      const toEmail = "adamp@monsterrg.com";

      // Accept date range (startDate + endDate) or single date, default to today
      let startDateParam = url.searchParams.get("startDate") ??
        url.searchParams.get("date");
      let endDateParam = url.searchParams.get("endDate");

      if (!startDateParam) {
        const now = new Date();
        startDateParam = now.toISOString().split("T")[0];
      }
      if (!endDateParam) {
        endDateParam = startDateParam;
      }

      const reportStartDate = new Date(`${startDateParam}T00:00:00-04:00`);
      const reportEndDate = new Date(`${endDateParam}T23:59:59-04:00`);

      // Format for display: MM/DD/YYYY
      const formatDateDisplay = (d: string) => {
        const [y, m, dd] = d.split("-");
        return `${m}/${dd}/${y}`;
      };
      const startDisplay = formatDateDisplay(startDateParam);
      const endDisplay = formatDateDisplay(endDateParam);
      const reportDateDisplay = startDateParam === endDateParam
        ? startDisplay
        : `${startDisplay} - ${endDisplay}`;

      console.log(
        `${timestamp} [Req:${requestId}] REPORT generating for range=${startDateParam} to ${endDateParam} display=${reportDateDisplay}`,
      );

      // ---- Gather dashboard stats (same logic as /api/dashboard/stats) ----
      const allEntries: any[] = [];
      const kvBreakdown: Record<
        string,
        { count: number; latest: string | null }
      > = {};
      const prefixesToScan = [["conversations"], ["scheduledinjection"], [
        "smsflowcontext",
      ]];

      for (const prefix of prefixesToScan) {
        const iter = kv.list({ prefix });
        const prefixName = prefix[0] as string;
        if (!kvBreakdown[prefixName]) {
          kvBreakdown[prefixName] = { count: 0, latest: null };
        }

        for await (const entry of iter) {
          const value = entry.value as any;

          let entryTimestamp: string | null = null;
          if (value?.timestamp) entryTimestamp = value.timestamp;
          else if (value?.processedAt) entryTimestamp = value.processedAt;
          else if (value?.scheduledAt) entryTimestamp = value.scheduledAt;
          else if (value?.createdAt) entryTimestamp = value.createdAt;
          else if (Array.isArray(entry.key) && entry.key.length === 4) {
            const possibleTs = entry.key[3];
            if (typeof possibleTs === "string" && possibleTs.includes("T")) {
              entryTimestamp = possibleTs;
            }
          }

          if (entryTimestamp) {
            const entryDate = new Date(entryTimestamp);
            if (entryDate < reportStartDate || entryDate > reportEndDate) {
              continue;
            }
          }

          kvBreakdown[prefixName].count++;
          if (entryTimestamp) {
            if (!kvBreakdown[prefixName].latest) {
              kvBreakdown[prefixName].latest = entryTimestamp;
            }
            if (kvBreakdown[prefixName].latest! < entryTimestamp) {
              kvBreakdown[prefixName].latest = entryTimestamp;
            }
          }

          allEntries.push({
            key: entry.key,
            value: entry.value,
            timestamp: entryTimestamp,
          });
        }
      }

      const conversationEntries = allEntries.filter((e) =>
        Array.isArray(e.key) && e.key[0] === "conversations"
      );

      const textsSent = conversationEntries.filter((e) =>
        e.value?.sender === "AI Bot"
      ).length;
      const initialTextsPhones = new Set(
        conversationEntries.filter((e) => {
          if (e.value?.sender !== "AI Bot") return false;
          const message = typeof e.value?.message === "string"
            ? e.value.message.trimStart()
            : "";
          return message.startsWith("Hey ") || message.startsWith("hey ");
        }).map((e) => e.value?.phoneNumber),
      );
      const initialTextsSent = initialTextsPhones.size;
      const uniquePhonesSent = new Set(
        conversationEntries.filter((e) => e.value?.sender === "AI Bot").map((
          e,
        ) => e.value?.phoneNumber),
      ).size;
      const peopleReplied = new Set(
        conversationEntries.filter((e) => e.value?.sender === "Guest").map((
          e,
        ) => e.value?.phoneNumber),
      ).size;
      const appointmentsSet = new Set(
        conversationEntries
          .filter((e) => isAppointmentMatch(e.value))
          .map((e) => e.value?.phoneNumber),
      ).size;
      const totalKvEntries = Object.values(kvBreakdown).reduce(
        (sum, b) => sum + (b.count || 0),
        0,
      );

      let activatedCount = 0;
      const activatedIter = kv.list({ prefix: ["guestactivated"] });
      for await (const _entry of activatedIter) activatedCount++;

      let answeredCount = 0;
      const answeredIter = kv.list({ prefix: ["guestanswered"] });
      for await (const _entry of answeredIter) answeredCount++;

      console.log(
        `${timestamp} [Req:${requestId}] REPORT stats: texts=${textsSent} replied=${peopleReplied} appts=${appointmentsSet} activated=${activatedCount} answered=${answeredCount}`,
      );

      // ---- Build CSV of all conversations for the date ----
      const csvRows: string[] = [
        "timestamp,phone,callId,sender,nodeTag,message",
      ];

      const sortedConvos = [...conversationEntries].sort((a, b) => {
        const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return at - bt;
      });

      for (const entry of sortedConvos) {
        const v = entry.value;
        const csvEscape = (s: string | null | undefined) => {
          if (!s) return "";
          const str = String(s).replace(/"/g, '""');
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str}"`
            : str;
        };
        csvRows.push(
          [
            csvEscape(v?.timestamp),
            csvEscape(v?.phoneNumber),
            csvEscape(v?.callId),
            csvEscape(v?.sender),
            csvEscape(v?.nodeTag),
            csvEscape(v?.message),
          ].join(","),
        );
      }

      const csvContent = csvRows.join("\n");
      const csvBase64 = btoa(unescape(encodeURIComponent(csvContent)));

      console.log(
        `${timestamp} [Req:${requestId}] REPORT CSV rows: ${
          csvRows.length - 1
        } conversations`,
      );

      // ---- Build HTML email body ----
      const replyRate = uniquePhonesSent > 0
        ? ((peopleReplied / uniquePhonesSent) * 100).toFixed(1)
        : "0";
      const conversionRate = peopleReplied > 0
        ? ((appointmentsSet / peopleReplied) * 100).toFixed(1)
        : "0";

      const htmlBody = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f2f5;">
<tr><td align="center" style="padding:24px 16px;">

  <!-- Main container -->
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;">

    <!-- Header -->
    <tr>
      <td style="background-color:#0f1b17;padding:28px 24px;text-align:center;">
        <h1 style="margin:0;font-size:22px;color:#27e39a;font-weight:800;letter-spacing:0.3px;">SMS Daily Report</h1>
        <p style="margin:8px 0 0;font-size:14px;color:#98a6ad;">${reportDateDisplay}</p>
      </td>
    </tr>

    <!-- Stats table -->
    <tr>
      <td style="padding:8px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f0f0f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:14px;color:#555;font-weight:600;">Texts Sent (total)</td>
                  <td align="right" style="font-size:18px;color:#0f1b17;font-weight:900;">${textsSent.toLocaleString()}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f0f0f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:14px;color:#555;font-weight:600;">Initial Texts Sent</td>
                  <td align="right" style="font-size:18px;color:#0f1b17;font-weight:900;">${initialTextsSent.toLocaleString()}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f0f0f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:14px;color:#555;font-weight:600;">Unique Recipients</td>
                  <td align="right" style="font-size:18px;color:#0f1b17;font-weight:900;">${uniquePhonesSent.toLocaleString()}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f0f0f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:14px;color:#555;font-weight:600;">People Replied</td>
                  <td align="right" style="font-size:18px;color:#0f1b17;font-weight:900;">${peopleReplied.toLocaleString()} <span style="font-size:13px;color:#777;font-weight:600;">(${replyRate}%)</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f0f0f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:14px;color:#555;font-weight:600;">Appointments Booked</td>
                  <td align="right" style="font-size:18px;color:#0f1b17;font-weight:900;">${appointmentsSet.toLocaleString()} <span style="font-size:13px;color:#777;font-weight:600;">(${conversionRate}%)</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f0f0f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:14px;color:#555;font-weight:600;">Total KV Records</td>
                  <td align="right" style="font-size:18px;color:#0f1b17;font-weight:900;">${totalKvEntries.toLocaleString()}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f0f0f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:14px;color:#555;font-weight:600;">&#9989; Activated</td>
                  <td align="right" style="font-size:18px;color:#19c37d;font-weight:900;">${activatedCount.toLocaleString()}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:14px;color:#555;font-weight:600;">&#9742; Answered Call</td>
                  <td align="right" style="font-size:18px;color:#19c37d;font-weight:900;">${answeredCount.toLocaleString()}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding:16px 24px;background-color:#f5f5f5;border-top:1px solid #eee;text-align:center;">
        <p style="margin:0;font-size:11px;color:#999;">Generated at ${
        new Date().toISOString()
      }</p>
        <p style="margin:4px 0 0;font-size:11px;color:#999;">Conversations CSV attached (${
        (csvRows.length - 1).toLocaleString()
      } rows)</p>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`;

      // ---- Send via Postmark ServerClient ----
      console.log(
        `${timestamp} [Req:${requestId}] REPORT sending via Postmark ServerClient...`,
      );

      try {
        const postmarkClient = new ServerClient(postmarkServerToken);

        const postmarkResult = await postmarkClient.sendEmail({
          From: fromEmail,
          To: toEmail,
          Subject: `SMS Daily Report — ${reportDateDisplay}`,
          HtmlBody: htmlBody,
          TextBody:
            `SMS Daily Report for ${reportDateDisplay}\n\nTexts Sent (total): ${textsSent}\nInitial Texts Sent: ${initialTextsSent}\nUnique Recipients: ${uniquePhonesSent}\nPeople Replied: ${peopleReplied} (${replyRate}%)\nAppointments Booked: ${appointmentsSet} (${conversionRate}%)\nTotal KV Records: ${totalKvEntries}\nActivated: ${activatedCount}\nAnswered: ${answeredCount}\n\nConversations CSV attached.`,
          Attachments: [
            {
              Name: `conversations-${startDateParam}_to_${endDateParam}.csv`,
              Content: csvBase64,
              ContentType: "text/csv",
            },
          ],
        });

        console.log(
          `${timestamp} [Req:${requestId}] REPORT email sent successfully via Postmark. MessageID=${
            postmarkResult?.MessageID ?? "unknown"
          }`,
        );

        return new Response(
          JSON.stringify({
            success: true,
            reportDate: reportDateDisplay,
            startDate: startDateParam,
            endDate: endDateParam,
            emailSentTo: toEmail,
            messageId: postmarkResult?.MessageID ?? null,
            stats: {
              textsSent,
              uniquePhonesSent,
              peopleReplied,
              appointmentsSet,
              totalKvEntries,
              activatedCount,
              answeredCount,
            },
            csvRows: csvRows.length - 1,
          }),
          { headers },
        );
      } catch (emailError: any) {
        console.error(
          `${timestamp} [Req:${requestId}] REPORT email send failed:`,
          emailError,
        );

        return new Response(
          JSON.stringify({
            success: false,
            error: emailError?.message ?? String(emailError),
          }),
          { status: 500, headers },
        );
      }
    }

    // -----------------------------
    // CATCH-ALL 404
    // -----------------------------
    console.log(`${timestamp} [Req:${requestId}] NO ROUTE MATCHED`);
    return new Response(
      JSON.stringify({
        error: "Not Found",
        requestedPath: pathname,
        method,
        availableRoutes: [
          "GET / (home UI when no legacy query)",
          "GET /?recordId=XXX (LEGACY root check)",
          "POST / (LEGACY root save)",
          "GET /dashboard (SMS Analytics Dashboard UI)",
          "GET /search (SMS Conversation Search UI)",
          "GET /audit (Audit Record Search UI)",
          "GET /api/dashboard/stats",
          "GET /api/dashboard/drill?startDate&endDate&sender",
          "GET /api/appointments?startDate&endDate&prefix&page&pageSize",
          "GET /api/conversations/search?phone=XXX",
          "GET /api/conversations/search2?phone=XXX&callId&sender&nodeTag&contains&limit",
          "GET /api/audit/browse?startDate&endDate&recordId&stage&page&pageSize",
          "GET /api/audit/check?recordId=XXX&stage=",
          "GET /api/audit/status?recordId=XXX",
          "POST /api/audit/save",
          "GET /api/state",
          "GET /api/kv/get",
          "POST /api/kv/set",
          "DELETE /api/kv/delete",
          "POST /api/kv/list",
          "POST /api/injection/schedule",
          "DELETE /api/injection/cancel",
          "GET|POST /api/cron/trigger",
          "GET /api/cron/trigger-single?phone=XXX",
          "POST /api/sales/record",
          "POST /api/guests/activate",
          "POST /api/guests/answered?Phone=XXX",
          "GET|POST /api/report/nightly?startDate&endDate",
        ],
      }),
      { status: 404, headers },
    );
  } catch (err: any) {
    console.error(`${timestamp} [Req:${requestId}] SERVER ERROR:`, err);
    console.error(`${timestamp} [Req:${requestId}] Stack:`, err?.stack);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers,
    });
  }
});
