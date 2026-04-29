// Resolves Basic-auth creds for a ReadyMode domain. Per-domain overrides
// (RM_<DOMAIN>_USER / RM_<DOMAIN>_PASS) take precedence over the default
// (RM_USER / RM_PASS). Throws if neither is set — no hardcoded defaults
// (the legacy `adam`/`Winter123` fallback is intentionally removed).

import { DialerDomain } from "@shared/types/readymode.ts";

export interface RmCreds {
  user: string;
  pass: string;
}

export function getRmCreds(domain: DialerDomain): RmCreds {
  const upperKey = domain.replace("monster", "").toUpperCase() || "MONSTER";
  // map the enum value (e.g. "monsterrg") to its short key for env lookup
  // MONSTER → "RG", ODS → "ODS", ODR → "ODR", ACT → "ACT", DS → "RD2"
  // For consistency with env/example, we allow both: per-domain explicit name
  // and the short key. Try both.
  const candidates = [
    `RM_${upperKey}_USER`,
    `RM_${domain.toUpperCase()}_USER`,
  ];
  let user: string | undefined;
  let pass: string | undefined;
  for (const u of candidates) {
    const p = u.replace("_USER", "_PASS");
    const eu = Deno.env.get(u);
    const ep = Deno.env.get(p);
    if (eu && ep) {
      user = eu;
      pass = ep;
      break;
    }
  }
  if (!user || !pass) {
    user = Deno.env.get("RM_USER") ?? undefined;
    pass = Deno.env.get("RM_PASS") ?? undefined;
  }
  if (!user || !pass) {
    throw new Error(
      `Missing RM creds for ${domain}. Set RM_USER + RM_PASS (or per-domain overrides).`,
    );
  }
  return { user, pass };
}
