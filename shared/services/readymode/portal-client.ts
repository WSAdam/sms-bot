// ReadyMode portal scraper. Replays the browser's auth flow to pull the
// authenticated Call Log Report — RM's published API doesn't expose call
// dispositions, so this is the realistic path.
//
// Auth flow:
//   1. GET  /login_new/?then=/   → server sets PHPSESSID via Set-Cookie
//   2. POST /login_new/?then=/   → form-encoded credentials; 302 sets sp,
//                                  stationId, saved_account
//   3. Combine all four into a Cookie header for subsequent calls.
//
// Data fetch:
//   1. POST /CCS%20Reports/call_log  → seeds the report session (empty body)
//   2. GET  /CCS%20Reports/call_log/update?...&report[page]=N
//                                    → JSON, 25 rows/page, paginated via
//                                      `pages` total in the response.
//
// Re-login on every cron run; we don't cache cookies (~1s overhead is fine,
// avoids stale-session edge cases).

import { DialerDomain } from "@shared/types/readymode.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

// All disposition-type IDs the browser sends — these unlock the union of
// every call category (No Answer, Sale, Not Interested, Can't Talk, etc.)
// plus the queue-routed inbound calls. Captured from Adam's network trace.
const REPORT_TYPE_PARAMS = [
  "6",
  "30",
  "31",
  "28",
  "29",
  "11",
  "13",
  "9",
  "14",
  "2",
  "21",
  "3",
  "8",
  "User,%",
  "Queue,3",
  "Queue,10",
  "Queue,15",
];

export interface SessionCookies {
  cookieHeader: string; // "PHPSESSID=...; sp=...; stationId=...; saved_account=..."
}

export interface DialerCallRow {
  phone10: string;
  agentName: string;
  disposition: string;
  callType: string | null;
  callTime: string; // ISO
  durationSecs: number; // talk time in seconds (RM "Calltime" cell, parsed)
  recId: string | null;
  callLogId: string;
  domain: string; // "monsterodr"
}

export interface RmCampaignList {
  // id (string) → human name. Surface for the "Campaign" column on the
  // dashboard. Cached server-side.
  [campaignId: string]: string;
}

export interface FetchCallLogResult {
  rows: DialerCallRow[];
  campaignList: RmCampaignList;
  pagesTotal: number;
}

// ── login ────────────────────────────────────────────────────────────────

export async function login(
  domain: DialerDomain | string,
  user: string,
  password: string,
  opts: { takeoverIfLoggedIn?: boolean } = {},
): Promise<SessionCookies> {
  const baseUrl = `https://${domain}.readymode.com`;
  // Step 1: GET to seed PHPSESSID
  const seedRes = await fetch(`${baseUrl}/login_new/?then=/`, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "manual",
  });
  // Drain the body — required so the connection releases cleanly.
  await seedRes.body?.cancel();
  const phpsessid = extractCookie(seedRes.headers, "PHPSESSID");
  if (!phpsessid) {
    throw new Error(
      `[rm-login ${domain}] step 1 failed: no PHPSESSID in Set-Cookie. ` +
        `Status=${seedRes.status}`,
    );
  }

  // Single POST login. Designed for a DEDICATED RM service-user account
  // (e.g. "monsterbot") — the cron must never collide with a human's
  // browser session, since RM's logout_other_sessions=on flow has a
  // server-side bug (500: "cURL malformed URL") that triggers when there
  // IS an active session to kick. Avoiding the kick entirely is the
  // cleanest path; that requires a separate user account in RM.
  //
  // Body is built RAW (not via URLSearchParams) to match the browser's
  // exact form encoding: slashes in `then` and `user_tz` left UN-encoded.
  //
  // set_st / set_sp = Adam's account station (3038) and its session prefix.
  // Hardcoded — empty values cause RM to skip the sp/stationId Set-Cookie
  // headers, which breaks downstream auth.
  const body = [
    `then=/`,
    `autoequals=WebRTC`,
    `user_tz=America/New_York`,
    `set_st=3038`,
    `set_sp=69f262f0ce3c2`,
    `use_phone_module=auto`,
    `then=/`,
    `login_account=${encodeURIComponent(user)}`,
    `login_password=${encodeURIComponent(password)}`,
  ].join("&");

  // Pre-claim the station + sp cookies. RM only re-issues sp/stationId
  // Set-Cookie headers when those cookies are present on the request — so
  // we send them upfront to trigger that behavior.
  const requestCookie =
    `PHPSESSID=${phpsessid}; stationId=3038; sp=69f262f0ce3c2`;

  let postRes = await fetch(`${baseUrl}/login_new/?then=/`, {
    method: "POST",
    headers: {
      "user-agent": UA,
      "content-type": "application/x-www-form-urlencoded",
      cookie: requestCookie,
      accept: "text/html",
    },
    body,
    redirect: "manual",
  });
  let respBody = await postRes.text().catch(() => "");

  // Reactive single-session takeover. When the bot account is already logged
  // in elsewhere, RM answers the first POST with a 200 "already logged in"
  // interstitial whose form carries logout_other_sessions=on. Re-POSTing the
  // SAME login + that flag — only AFTER seeing the interstitial, never on the
  // first POST (which 500s with "cURL malformed URL") — evicts the stale
  // session, mirroring RM's "Continue" button. Opt-in: the daily cron runs at
  // 5:30 AM ET when nobody's on, but manual/triage pulls fire mid-day and need
  // to kick a human's lingering session.
  if (
    opts.takeoverIfLoggedIn &&
    postRes.status === 200 &&
    /already logged in|We're sorry|log out all your other sessions/i.test(
      respBody,
    )
  ) {
    console.log(
      `[rm-login ${domain}] account already logged in — sending logout_other_sessions takeover`,
    );
    // Reuse the live PHPSESSID (RM may have rotated it on the interstitial)
    // plus the seH the server set and the pre-claimed station/sp — the same
    // jar the "Continue" form posts back with.
    const phpForKick = extractCookie(postRes.headers, "PHPSESSID") ?? phpsessid;
    const seH = extractCookie(postRes.headers, "seH") ??
      extractCookie(seedRes.headers, "seH");
    const kickCookie = [
      `PHPSESSID=${phpForKick}`,
      `stationId=3038`,
      `sp=69f262f0ce3c2`,
      ...(seH ? [`seH=${seH}`] : []),
    ].join("; ");
    postRes = await fetch(`${baseUrl}/login_new/?then=/`, {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/x-www-form-urlencoded",
        cookie: kickCookie,
        referer: `${baseUrl}/login_new/?then=/`,
        origin: baseUrl,
        accept: "text/html",
      },
      body: `${body}&logout_other_sessions=on`,
      redirect: "manual",
    });
    respBody = await postRes.text().catch(() => "");
  }

  if (postRes.status >= 400) {
    throw new Error(
      `[rm-login ${domain}] step 2 status=${postRes.status}. Body sample: "${
        respBody.slice(0, 500)
      }"`,
    );
  }

  // 200 + "already logged in" = the dedicated bot account is ALSO active
  // somewhere (admin somehow logged into it). Surface a clear error so
  // the operator knows to investigate.
  const failMatch = respBody.match(
    /id="login_fail"[^>]*>[\s\S]*?<p>\s*([\s\S]{1,400}?)<\/p>/i,
  );
  if (failMatch) {
    const msg = failMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
      .trim();
    throw new Error(
      `[rm-login ${domain}] login rejected: ${msg}. ` +
        `If "already logged in", another process is using the bot account; ` +
        `the cron requires exclusive access to RM_USER.`,
    );
  }

  // Debug: dump every Set-Cookie the server returned. Helps diagnose
  // partial-success scenarios (e.g. saved_account but no sp/stationId).
  // deno-lint-ignore no-explicit-any
  const allSc = (postRes.headers as any).getSetCookie?.() ?? [];
  console.log(
    `[rm-login ${domain}] step 2 status=${postRes.status} set-cookies: ${
      allSc.map((s: string) => s.split(";")[0]).join(" | ") || "(none)"
    }`,
  );

  // PHP regenerates PHPSESSID on successful login (anti-fixation). Use the
  // new one if present, otherwise fall back to the seed.
  const newPhpsessid = extractCookie(postRes.headers, "PHPSESSID") ??
    phpsessid;
  // Behavior we observed: the server sets `saved_account` reliably but only
  // re-sets `sp`/`stationId` when those cookies were present in the request
  // (which we did pre-claim above). When it doesn't re-set them, our claimed
  // values are still the live session truth — fall back to them.
  const sp = extractCookie(postRes.headers, "sp") ?? "69f262f0ce3c2";
  const stationId = extractCookie(postRes.headers, "stationId") ?? "3038";
  const savedAccount = extractCookie(postRes.headers, "saved_account");
  if (!savedAccount) {
    throw new Error(
      `[rm-login ${domain}] step 2 auth failed: no saved_account in ` +
        `Set-Cookie. Status=${postRes.status}. Check RM_USER/RM_PASS.`,
    );
  }

  const cookieHeader = [
    `PHPSESSID=${newPhpsessid}`,
    `sp=${sp}`,
    `stationId=${stationId}`,
    `saved_account=${savedAccount}`,
  ].join("; ");

  console.log(`[rm-login ${domain}] ✅ logged in as "${savedAccount}"`);
  return { cookieHeader };
}

// ── fetchCallLog ─────────────────────────────────────────────────────────

export interface FetchCallLogOptions {
  // Hard cap on pages — useful for testing or when we just want a sample.
  // 0/undefined = no cap (paginate until pages_total).
  maxPages?: number;
  // Call-log REPORT campaign id (integer, e.g. "81" = Appointments) for the
  // restrict_campaign filter. "0"/undefined = all campaigns. See
  // APPOINTMENTS_CAMPAIGN_REPORT_ID in shared/config/constants.ts.
  restrictCampaign?: string;
}

export async function fetchCallLog(
  session: SessionCookies,
  domain: DialerDomain | string,
  fromDateMmDdYyyy: string,
  toDateMmDdYyyy: string,
  options: FetchCallLogOptions = {},
): Promise<FetchCallLogResult> {
  const baseUrl = `https://${domain}.readymode.com`;
  const commonHeaders = {
    "user-agent": UA,
    cookie: session.cookieHeader,
    "x-requested-with": "XMLHttpRequest",
    "x-apex-log-accept": "1",
    referer: `${baseUrl}/`,
  };

  // Step 1: seed the report session (empty POST). Browser does this when
  // you click into the Call Log Report; we replay for parity.
  const seedRes = await fetch(`${baseUrl}/CCS%20Reports/call_log`, {
    method: "POST",
    headers: { ...commonHeaders, "content-length": "0" },
  });
  await seedRes.body?.cancel();
  if (!seedRes.ok && seedRes.status !== 302) {
    throw new Error(
      `[rm-call-log ${domain}] seed POST failed: status=${seedRes.status}`,
    );
  }

  // Step 2: paginate
  const rows: DialerCallRow[] = [];
  let campaignList: RmCampaignList = {};
  let pagesTotal = 0;
  let page = 0;
  while (true) {
    const url = buildUpdateUrl(
      baseUrl,
      fromDateMmDdYyyy,
      toDateMmDdYyyy,
      page,
      options.restrictCampaign ?? "0",
    );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort("page-timeout"), 30_000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { ...commonHeaders, accept: "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `[rm-call-log ${domain}] page ${page} failed: status=${res.status} body=${
          body.slice(0, 200)
        }`,
      );
    }
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `[rm-call-log ${domain}] page ${page} non-JSON body (likely session ` +
          `rejection): "${text.slice(0, 250)}"`,
      );
    }
    if (page === 0) {
      pagesTotal = Number(json.pages ?? 0);
      const cl = json.campaignlist;
      if (cl && typeof cl === "object") {
        campaignList = { ...cl };
      }
    }
    const results = json.results as Record<string, unknown> | undefined;
    if (results && typeof results === "object") {
      for (const key of Object.keys(results)) {
        const row = parseCallLogRow(results[key], domain, fromDateMmDdYyyy);
        if (row) rows.push(row);
      }
    }
    page++;
    if (page >= pagesTotal) break;
    if (options.maxPages && page >= options.maxPages) break;
    // Be polite — don't hammer the portal back-to-back.
    await sleep(50);
  }

  // Dedupe by callLogId (server primary key). Should be unique already, but
  // guards against pagination edge cases.
  const seen = new Set<string>();
  const deduped: DialerCallRow[] = [];
  for (const r of rows) {
    if (seen.has(r.callLogId)) continue;
    seen.add(r.callLogId);
    deduped.push(r);
  }

  console.log(
    `[rm-call-log ${domain}] ${fromDateMmDdYyyy}–${toDateMmDdYyyy}: pages=${pagesTotal} rows=${deduped.length} (campaignList=${
      Object.keys(campaignList).length
    })`,
  );
  return { rows: deduped, campaignList, pagesTotal };
}

// ── helpers ──────────────────────────────────────────────────────────────

function buildUpdateUrl(
  baseUrl: string,
  fromMmDdYyyy: string,
  toMmDdYyyy: string,
  page: number,
  restrictCampaign: string,
): string {
  const params = new URLSearchParams();
  params.set("update", "1");
  for (const t of REPORT_TYPE_PARAMS) {
    params.append("report[types][]", t);
  }
  params.set("report[time_from_d]", fromMmDdYyyy);
  params.set("report[time_from_dateonly]", "1");
  params.set("report[time_to_d]", toMmDdYyyy);
  params.set("report[time_to_dateonly]", "1");
  params.set("report[restrict_uid]", "0");
  params.set("report[restrict_campaign]", restrictCampaign);
  params.set("report[restrict_batch]", "0");
  params.set("report[sourceFilter]", "-1");
  params.set("report[durationFilter]", "-1");
  params.set("report[callTypeFilter]", "_");
  params.set("report[page]", String(page));
  return `${baseUrl}/CCS%20Reports/call_log/update?${params.toString()}`;
}

function parseCallLogRow(
  raw: unknown,
  domain: string,
  fromMmDdYyyy: string,
): DialerCallRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const file = typeof r.File === "string" ? r.File : "";
  const phone10 = extractFirstPhone10(file);
  if (!phone10) return null; // phone-less rows (rare; internal actions)
  const callLogId = typeof r.id === "string"
    ? r.id
    : typeof r.id === "number"
    ? String(r.id)
    : null;
  if (!callLogId) return null;
  const disposition = typeof r.Type === "string" ? r.Type : "";
  const agentName = typeof r.User === "string" ? r.User : "";
  const callType = typeof r.call_type === "string" ? r.call_type : null;
  const recId = typeof r.RecId === "string" ? r.RecId : null;
  const timeStr = typeof r.Time === "string" ? r.Time : "";
  const callTime = parseEtTimeToIso(timeStr, fromMmDdYyyy);
  const durationSecs = parseDurationSeconds(
    typeof r.Calltime === "string" ? r.Calltime : "",
  );
  return {
    phone10,
    agentName,
    disposition,
    callType,
    callTime,
    durationSecs,
    recId,
    callLogId,
    domain,
  };
}

// Parse RM's Calltime cell ("<small>21 min</small>", "<small ...><30s</small>",
// "< 1m", "2:05") into seconds. A leading "<" (e.g. "<30s", "< 1m") is an upper
// bound BELOW the bucket → 0 (under any real-conversation threshold). Exported
// for reuse by the import + backfill paths.
export function parseDurationSeconds(raw: string): number {
  const text = raw.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  if (!text || text.startsWith("<")) return 0;
  const colon = text.match(/^(\d+):(\d{2})$/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  let secs = 0;
  const hr = text.match(/(\d+)\s*(?:hr|hour)/i);
  if (hr) secs += parseInt(hr[1], 10) * 3600;
  const min = text.match(/(\d+)\s*min/i);
  if (min) secs += parseInt(min[1], 10) * 60;
  const sec = text.match(/(\d+)\s*s(?:ec)?\b/i);
  if (sec) secs += parseInt(sec[1], 10);
  return secs;
}

// Extracts the FIRST (XXX) XXX-XXXX phone from a `File` field text. Returns
// the 10-digit string. Returns null when no phone is present.
function extractFirstPhone10(file: string): string | null {
  const m = file.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

// Parses RM's `"May 7, 11:21PM"` formatted time with the date hint we used
// in the request. Returns ISO assuming Eastern Time. Falls back to the
// fromDate's start-of-day if parsing fails (so the row still imports — the
// dashboard treats the date as a soft signal).
const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export function parseEtTimeToIso(
  timeStr: string,
  fallbackMmDdYyyy: string,
): string {
  // Format: "May 7, 11:21PM" or "May 7, 11:21AM"
  const m = timeStr.match(
    /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})(AM|PM)$/,
  );
  if (m) {
    const monthIdx = MONTHS[m[1]];
    const day = parseInt(m[2], 10);
    let hour = parseInt(m[3], 10);
    const minute = parseInt(m[4], 10);
    const ampm = m[5];
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    if (monthIdx !== undefined) {
      // Year inference: use the year from the requested date range.
      const year = inferYearFromMmDdYyyy(fallbackMmDdYyyy);
      // Build an ET timestamp. ET is UTC-5 (EST) or UTC-4 (EDT). For simplicity
      // and because RM doesn't tell us which, we use a fixed -04:00 offset
      // (EDT, accurate from Mar→Nov). January–February records will be off by
      // an hour but are tolerable for our use case.
      const offset = "-04:00";
      const iso = `${year}-${pad(monthIdx + 1)}-${pad(day)}T${pad(hour)}:${
        pad(minute)
      }:00${offset}`;
      // Validate
      if (Number.isFinite(new Date(iso).getTime())) return iso;
    }
  }
  // Fallback: midnight of the requested fromDate
  const [mm, dd, yyyy] = fallbackMmDdYyyy.split("/");
  return `${yyyy}-${mm}-${dd}T00:00:00-04:00`;
}

function inferYearFromMmDdYyyy(mmDdYyyy: string): number {
  const parts = mmDdYyyy.split("/");
  return parseInt(parts[2] ?? String(new Date().getFullYear()), 10);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Parse Set-Cookie. `Headers.getSetCookie()` returns an array of all
// Set-Cookie values. We pluck the first match for the named cookie.
function extractCookie(headers: Headers, name: string): string | null {
  // Deno supports getSetCookie(); fallback to forEach for robustness.
  // deno-lint-ignore no-explicit-any
  const getter = (headers as any).getSetCookie?.bind(headers);
  const setCookies: string[] = typeof getter === "function" ? getter() : [];
  for (const sc of setCookies) {
    const idx = sc.indexOf("=");
    if (idx < 0) continue;
    const key = sc.slice(0, idx).trim();
    if (key === name) {
      const valEnd = sc.indexOf(";", idx);
      return valEnd >= 0 ? sc.slice(idx + 1, valEnd) : sc.slice(idx + 1);
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
