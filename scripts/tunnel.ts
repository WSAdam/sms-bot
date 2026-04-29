// Spawns ngrok with the env-specific config file from data/ngrok.{env}.yaml.
//
// Usage:
//   deno task tunnel --env=dev      (default)
//   deno task tunnel --env=prod
//   deno task tunnel --env=solo
//
// Reads NGROK_KEY from env (set in env/local or shell).

import { parseArgs } from "@std/cli/parse-args";
import { fromFileUrl, join } from "@std/path";

const { env } = parseArgs(Deno.args, {
  string: ["env"],
  default: { env: "dev" },
});

const allowed = ["dev", "prod", "solo"] as const;
if (!allowed.includes(env as (typeof allowed)[number])) {
  console.error(
    `❌ --env must be one of: ${allowed.join(", ")} (got: ${env})`,
  );
  Deno.exit(1);
}

const repoRoot = fromFileUrl(new URL("../", import.meta.url));
const configPath = join(repoRoot, "data", `ngrok.${env}.yaml`);

try {
  await Deno.stat(configPath);
} catch {
  console.error(`❌ Missing ngrok config: ${configPath}`);
  console.error(
    `   Copy data/ngrok.${env}.yaml.example → data/ngrok.${env}.yaml and fill in your subdomains.`,
  );
  Deno.exit(1);
}

const key = Deno.env.get("NGROK_KEY");
if (!key) {
  console.error("❌ NGROK_KEY env var not set.");
  Deno.exit(1);
}

console.log(`🚀 Starting ngrok with config ${configPath}`);

const command = new Deno.Command("ngrok", {
  env: { NGROK_AUTHTOKEN: key },
  args: ["start", "--all", "--config", configPath],
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const { code } = await command.spawn().status;
Deno.exit(code);
