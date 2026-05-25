// Boundary guard regression test. scheduleInjection() must refuse any
// eventTime that lacks a TZ marker (Z or ±HH:MM). Without this guard,
// a value like "2026-06-14T07:30:00" silently lands in Firestore and
// the sweep dials it 4h early in EDT — the exact bug that triggered
// the 2026-05-25 incident.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { scheduleInjection } from "@shared/services/injections/schedule.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("scheduleInjection rejects TZ-naive eventTime (no Z, no offset)", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    await assertRejects(
      () => scheduleInjection("5551239881", "2026-06-14T07:30:00"),
      Error,
      "scheduleInjection: eventTime must be canonical UTC",
    );
    // And nothing should have been written.
    assertEquals(mock.docs.size, 0);
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("scheduleInjection accepts canonical UTC (Z) eventTime", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    await scheduleInjection("5551239882", "2026-06-14T11:30:00.000Z");
    // Got past the guard — the scheduledinjection doc was written.
    const written = Array.from(mock.docs.keys()).some((p) =>
      p.includes("5551239882")
    );
    assert(written, "scheduledinjection doc should have been written");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("scheduleInjection accepts offset-tagged eventTime (-04:00)", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    await scheduleInjection("5551239883", "2026-06-14T07:30:00-04:00");
    const written = Array.from(mock.docs.keys()).some((p) =>
      p.includes("5551239883")
    );
    assert(written, "scheduledinjection doc should have been written");
  } finally {
    setFirestoreClientForTests(null);
  }
});
