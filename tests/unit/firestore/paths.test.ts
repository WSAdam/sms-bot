import { assertEquals } from "@std/assert";
import {
  abTestDocPath,
  auditDocPath,
  auditStageDocPath,
  conversationDocPath,
  globalSmsCountDocPath,
  guestActivatedDocPath,
  guestAnsweredDocPath,
  injectionHistoryDocPath,
  leadPointerDocPath,
  rateLimitDocPath,
  salesWithin7dDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";

Deno.test("doc paths mirror context.md §6 schema", () => {
  assertEquals(auditDocPath("rec1"), "sms-bot/audit/byRecordId/rec1");
  assertEquals(
    auditStageDocPath("landing", "rec1"),
    "sms-bot/auditstage/landing/rec1",
  );
  assertEquals(
    scheduledInjectionDocPath("9366762277"),
    "sms-bot/scheduledinjections/byPhone/9366762277",
  );
  assertEquals(
    guestActivatedDocPath("9366762277"),
    "sms-bot/guestactivated/byPhone/9366762277",
  );
  assertEquals(
    guestAnsweredDocPath("9366762277"),
    "sms-bot/guestanswered/byPhone/9366762277",
  );
  assertEquals(
    salesWithin7dDocPath("9366762277"),
    "sms-bot/saleswithin7d/byPhone/9366762277",
  );
  assertEquals(
    leadPointerDocPath("9366762277"),
    "sms-bot/leadpointer/byPhone/9366762277",
  );
  assertEquals(
    rateLimitDocPath("9366762277"),
    "sms-bot/ratelimit/byPhone/9366762277",
  );
  assertEquals(
    abTestDocPath("9366762277"),
    "sms-bot/abtest/byPhone/9366762277",
  );
  assertEquals(
    globalSmsCountDocPath("2026-04-28"),
    "sms-bot/globalsmscount/byDate/2026-04-28",
  );
  assertEquals(
    conversationDocPath("9366762277__call_abc__2026-04-28T16:00:00.000Z"),
    "sms-bot/conversations/messages/9366762277__call_abc__2026-04-28T16:00:00.000Z",
  );
  assertEquals(
    injectionHistoryDocPath("9366762277__2026-04-28T16:00:00.000Z"),
    "sms-bot/injectionhistory/byPhone/9366762277__2026-04-28T16:00:00.000Z",
  );
});
