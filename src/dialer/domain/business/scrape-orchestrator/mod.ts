// Top-level orchestrator: log in, fetch the call log for a date range,
// import dispositions, refresh the campaign-name cache. Single entry
// point used by both the daily cron (yesterday only) and the admin
// endpoint (custom date range).

import { APPOINTMENTS_CAMPAIGN_REPORT_ID } from "@shared/config/constants.ts";
import {
  configSettingsCollection,
  readymodeCampaignsDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { getRmCreds } from "@dialer/domain/data/rm-auth/mod.ts";
import { importDailyDispositions } from "@dialer/domain/business/import-dispositions/mod.ts";
import {
  fetchCallLog,
  login,
  type RmCampaignList,
} from "@dialer/domain/data/portal-client/mod.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

export interface ScrapeOptions {
  /** "MM/DD/YYYY" — default = yesterday (ET). */
  fromDate?: string;
  /** "MM/DD/YYYY" — default = same as fromDate. */
  toDate?: string;
  /** Subset of domains to scrape; default = ODR only (others typically empty). */
  domains?: DialerDomain[];
  /** Hard cap on pages per domain (testing). */
  maxPagesPerDomain?: number;
  /**
   * Call-log REPORT campaign id to restrict to. Default = Appointments (81),
   * the campaign all our leads are dialed in — so the pull is ~1 page and the
   * answered metric is gated to our leads without the injectionhistory funnel.
   * Pass "0" to pull ALL campaigns (keeps the answered⊆booked funnel gate on).
   */
  restrictCampaign?: string;
  /**
   * On an "already logged in" rejection, kick the stale session via
   * logout_other_sessions=on and retry (mirrors RM's "Continue"). Default off:
   * the 5:30 AM cron runs when nobody's on, but manual/triage pulls fire mid-day
   * and need to take over a lingering human session.
   */
  takeoverIfLoggedIn?: boolean;
}

export interface ScrapeResult {
  fromDate: string;
  toDate: string;
  perDomain: Array<{
    domain: string;
    rowsFetched: number;
    dispositionsWritten: number;
    answeredUpserted: number;
    answeredAlreadyEarlier: number;
    excludedSkipped: number;
    pagesTotal: number;
    error?: string;
  }>;
  totals: {
    rowsFetched: number;
    dispositionsWritten: number;
    answeredUpserted: number;
  };
}

const DEFAULT_DOMAINS: DialerDomain[] = [DialerDomain.ODR];

export async function scrapeReadymode(
  options: ScrapeOptions = {},
): Promise<ScrapeResult> {
  const fromDate = options.fromDate ?? yesterdayMmDdYyyyEt();
  const toDate = options.toDate ?? fromDate;
  const domains = options.domains ?? DEFAULT_DOMAINS;
  const restrictCampaign = options.restrictCampaign ??
    APPOINTMENTS_CAMPAIGN_REPORT_ID;

  const result: ScrapeResult = {
    fromDate,
    toDate,
    perDomain: [],
    totals: { rowsFetched: 0, dispositionsWritten: 0, answeredUpserted: 0 },
  };

  // Merged campaign-list across all domains. Cached to Firestore at the
  // end so the dashboard can render campaign names without scraping again.
  const mergedCampaigns: RmCampaignList = {};

  for (const domain of domains) {
    try {
      const creds = getRmCreds(domain);
      const session = await login(domain, creds.user, creds.pass, {
        takeoverIfLoggedIn: options.takeoverIfLoggedIn,
      });
      const fetchResult = await fetchCallLog(
        session,
        domain,
        fromDate,
        toDate,
        { maxPages: options.maxPagesPerDomain, restrictCampaign },
      );
      Object.assign(mergedCampaigns, fetchResult.campaignList);

      // Campaign-restricted pull → every row is our lead, so drop the funnel
      // gate; all-campaigns pull ("0") keeps it (answered ⊆ booked).
      const importSummary = await importDailyDispositions(fetchResult.rows, {
        requireInFunnel: restrictCampaign === "0",
      });
      result.perDomain.push({
        domain,
        rowsFetched: importSummary.rowsFetched,
        dispositionsWritten: importSummary.dispositionsWritten,
        answeredUpserted: importSummary.answeredUpserted,
        answeredAlreadyEarlier: importSummary.answeredAlreadyEarlier,
        excludedSkipped: importSummary.excludedSkipped,
        pagesTotal: fetchResult.pagesTotal,
      });
      result.totals.rowsFetched += importSummary.rowsFetched;
      result.totals.dispositionsWritten += importSummary.dispositionsWritten;
      result.totals.answeredUpserted += importSummary.answeredUpserted;
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[rm-scrape] ❌ ${domain}: ${msg}`);
      result.perDomain.push({
        domain,
        rowsFetched: 0,
        dispositionsWritten: 0,
        answeredUpserted: 0,
        answeredAlreadyEarlier: 0,
        excludedSkipped: 0,
        pagesTotal: 0,
        error: msg,
      });
    }
  }

  // Persist the campaign-name map for the dashboard to use.
  if (Object.keys(mergedCampaigns).length > 0) {
    try {
      await getFirestoreClient().set(readymodeCampaignsDocPath(), {
        campaigns: mergedCampaigns,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(
        `[rm-scrape] ⚠ failed to cache campaign list: ${(e as Error).message}`,
      );
    }
  }

  console.log(
    `[rm-scrape] ${fromDate}→${toDate} done: rows=${result.totals.rowsFetched} dispositions=${result.totals.dispositionsWritten} answered=${result.totals.answeredUpserted}`,
  );
  return result;
}

// "MM/DD/YYYY" formatted yesterday in Eastern Time. Matches RM's UI's
// expected date format. Used as the cron's default window.
export function yesterdayMmDdYyyyEt(): string {
  // Day-shift in ET, then format as MM/DD/YYYY.
  const nowEt = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  }); // YYYY-MM-DD
  const [y, m, d] = nowEt.split("-").map((s) => parseInt(s, 10));
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yy = yesterday.getUTCFullYear();
  const mm = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(yesterday.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${yy}`;
}

// Suppress unused-import warning — readymodeCampaignsDocPath is only one
// of two paths we read from configSettingsCollection. Keep the import for
// when we extend with other settings reads.
void configSettingsCollection;
