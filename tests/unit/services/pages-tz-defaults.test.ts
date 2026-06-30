// Guards the timezone correctness of the Test/Review pages' client-side date
// defaults. These run as browser JS embedded in exported HTML template strings,
// so they can't be invoked under deno test — we assert the load-bearing source
// shape instead. The bug class: an ET calendar day computed from UTC getters /
// toISOString() reads tomorrow after ~8 PM ET.

import { assert } from "@std/assert";
import { reviewPageHtml, testPageHtml } from "@shared/ui/pages.ts";

Deno.test("review page: the date filter default uses the ET calendar day, not the UTC day", () => {
  // The reviewDate initializer must derive the ET wall-clock day via
  // toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), NOT
  // toISOString().split('T')[0] (which is the UTC day and jumps to tomorrow
  // after ~8 PM ET).
  assert(
    /reviewDate[\s\S]{0,40}value/.test(reviewPageHtml),
    "review page must still set reviewDate.value",
  );
  assert(
    /new Date\(\)\.toLocaleDateString\("en-CA",\s*\{\s*timeZone:\s*"America\/New_York"/
      .test(reviewPageHtml),
    "review page date default must use the America/New_York calendar day",
  );
  assert(
    !/const today = new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]/.test(
      reviewPageHtml,
    ),
    "review page must NOT default the date filter from the UTC day (toISOString)",
  );
});

Deno.test("test page: datetime-local defaults derive ET wall-clock parts via Intl, not local getters", () => {
  // defaultDateTimeLocal must build the YYYY-MM-DDTHH:mm string from
  // Intl.DateTimeFormat ET parts, NOT d.getFullYear()/getMonth()/getHours()
  // (host-local fields → UTC clock on a UTC-hosted preview).
  assert(
    testPageHtml.includes('timeZone: "America/New_York"'),
    "defaultDateTimeLocal must read the America/New_York wall-clock",
  );
  assert(
    !/d\.getFullYear\(\)\s*\+\s*"-"\s*\+\s*pad\(d\.getMonth\(\)\+1\)/.test(
      testPageHtml,
    ),
    "the datetime-local default must NOT be assembled from local getters",
  );
});

Deno.test("test page: run handlers send the raw TZ-naive datetime-local, not toISOString()", () => {
  // runApptBooked / runInjectionSchedule / runCalSchedule must pass the raw
  // datetime-local string so the backend's normalizeAppointmentTime applies the
  // ET default. new Date(local).toISOString() re-stamps a 'Z' and defeats that.
  assert(
    !/=\s*local\s*\?\s*new Date\(local\)\.toISOString\(\)/.test(testPageHtml),
    "run handlers must not convert the datetime-local via `local ? new Date(local).toISOString()`",
  );
  // The three fields are assigned directly from `local` with a fallback.
  for (const name of ["event_time", "eventTime", "startTime"]) {
    assert(
      testPageHtml.includes(`const local = param(card, "${name}");`),
      `${name} handler must read the raw datetime-local param`,
    );
  }
});
