// Guards graceful degradation of the daily QB sale-match cron when the
// cronConfig Firestore read fails. Unlike the nightly report (which fails CLOSED
// on a config-read failure — a wrong-config email is worse than no email),
// skipping sale-match for a day is silent data LOSS. So a transient blip on the
// getCronConfig() read must NOT abort the whole match: it falls back to the
// static qbSaleMatch defaults (reportId/tableId/enabled) and keeps running.

import { assert, assertEquals } from "@std/assert";
import { CRON_CONFIG_DEFAULTS } from "@core/business/cron-config/mod.ts";
import { cronConfigDocPath } from "@core/data/firestore-paths/mod.ts";
import { runDailyQbSaleMatch } from "@crm/domain/business/sale-match-cron/mod.ts";
import {
  type QuickbaseClient,
  setQuickbaseClientForTests,
} from "@crm/domain/data/qb-client/mod.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("runDailyQbSaleMatch: a cronConfig read failure degrades to static defaults instead of aborting", async () => {
  const mock = new FirestoreMock();
  // Fail ONLY the cronConfig read (the getCronConfig path). Other reads (the
  // sale-match matching) behave normally — here there are no rows to match.
  const origGet = mock.get.bind(mock);
  mock.get = (path: string) => {
    if (path === cronConfigDocPath()) {
      return Promise.reject(new Error("getaddrinfo EAI_AGAIN"));
    }
    return origGet(path);
  };
  setFirestoreClientForTests(mock);

  // Capture which report/table the cron ended up using, and return an empty
  // report so no matching work (and no further Firestore reads) is needed.
  let usedTableId: string | undefined;
  let usedReportId: string | undefined;
  const qb: QuickbaseClient = {
    getReport: (tableID: string, reportID: string) => {
      usedTableId = tableID;
      usedReportId = reportID;
      return Promise.resolve({ data: [], fields: [] });
    },
    findReservationByResID: () => Promise.resolve(null),
    markDNC: () => Promise.resolve({ success: true }),
    isDNC: () => Promise.resolve(false),
  };
  setQuickbaseClientForTests(qb);

  try {
    const r = await runDailyQbSaleMatch();
    assert(
      r.ok,
      `the cron must still run on a config-read blip, not abort; got reason=${r.reason}`,
    );
    // It fell back to the static qbSaleMatch defaults.
    assertEquals(
      usedReportId,
      CRON_CONFIG_DEFAULTS.qbSaleMatch.reportId,
      "must use the default reportId when config read fails",
    );
    assertEquals(
      usedTableId,
      CRON_CONFIG_DEFAULTS.qbSaleMatch.tableId,
      "must use the default tableId when config read fails",
    );
  } finally {
    setFirestoreClientForTests(null);
    setQuickbaseClientForTests(null);
  }
});

Deno.test("runDailyQbSaleMatch: explicit caller args still win over the fallback defaults on a config blip", async () => {
  const mock = new FirestoreMock();
  mock.get = (path: string) => {
    if (path === cronConfigDocPath()) {
      return Promise.reject(new Error("getaddrinfo EAI_AGAIN"));
    }
    return Promise.resolve(null);
  };
  setFirestoreClientForTests(mock);

  let usedTableId: string | undefined;
  let usedReportId: string | undefined;
  const qb: QuickbaseClient = {
    getReport: (tableID: string, reportID: string) => {
      usedTableId = tableID;
      usedReportId = reportID;
      return Promise.resolve({ data: [], fields: [] });
    },
    findReservationByResID: () => Promise.resolve(null),
    markDNC: () => Promise.resolve({ success: true }),
    isDNC: () => Promise.resolve(false),
  };
  setQuickbaseClientForTests(qb);

  try {
    const r = await runDailyQbSaleMatch("999", "ztable999");
    assert(r.ok);
    assertEquals(usedReportId, "999", "caller reportId arg wins");
    assertEquals(usedTableId, "ztable999", "caller tableId arg wins");
  } finally {
    setFirestoreClientForTests(null);
    setQuickbaseClientForTests(null);
  }
});
