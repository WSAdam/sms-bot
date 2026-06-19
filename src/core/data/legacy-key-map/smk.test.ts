import { assertEquals } from "#assert";
import { legacyKeyToDocPath } from "./mod.ts";

// Pure translation — assertable with no mock. Locks the contract instead of
// just proving the module imports.
Deno.test("legacy-key-map: translates a known key to a deterministic path", () => {
  const r = legacyKeyToDocPath(["audit", "rec123"]);
  assertEquals(r !== null, true);
  // re-derivable: same legacy key → same path, and it carries the id
  assertEquals(r, legacyKeyToDocPath(["audit", "rec123"]));
  assertEquals(r!.path.endsWith("rec123"), true);
});

Deno.test("legacy-key-map: rejects empty, unknown, and wrong-arity keys", () => {
  assertEquals(legacyKeyToDocPath([]), null);
  assertEquals(legacyKeyToDocPath(["bogus", "x"]), null);
  assertEquals(legacyKeyToDocPath(["audit"]), null);
});
