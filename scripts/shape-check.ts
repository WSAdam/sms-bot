// Wraps the shape-checker binary so `deno task shape-check` works without
// hardcoding the absolute path everywhere. Forwards any extra args to the binary.

import { fromFileUrl } from "@std/path";

const BIN =
  "/Users/adam/Programming/keystone/keystone-suite/external/projects/shape-checker/dist/shape-checker";

try {
  await Deno.stat(BIN);
} catch {
  console.error(`❌ shape-checker binary not found at ${BIN}`);
  Deno.exit(1);
}

const repoRoot = fromFileUrl(new URL("../", import.meta.url));

const cmd = new Deno.Command(BIN, {
  args: Deno.args,
  cwd: repoRoot,
  stdout: "inherit",
  stderr: "inherit",
});

const { code } = await cmd.spawn().status;
Deno.exit(code);
