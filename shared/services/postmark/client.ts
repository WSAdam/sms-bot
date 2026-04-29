// Wrapper around the npm:postmark ServerClient. Both the import and the
// instantiation are deferred so postmark's CJS-internals never load until a
// route actually calls sendReport(). Without this, Vite's SSR bundle pulls
// postmark eagerly and Deno Deploy 500s every API route with
// "module is not defined".
//
// Tests should mock this module entirely (do not call real Postmark).

import {
  POSTMARK_DEFAULT_TO,
  POSTMARK_FROM_ADDRESS,
} from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";

// See shared/firestore/client.ts for the full why — short version: building
// the import call via `new Function` keeps Vite from inlining postmark's CJS
// into the SSR bundle, which would otherwise 500 every API route on Deno
// Deploy with "module is not defined".
// deno-lint-ignore no-explicit-any
const dynamicImport: (specifier: string) => Promise<any> = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown> as (specifier: string) => Promise<unknown>;

// deno-lint-ignore no-explicit-any
let client: any = null;

// deno-lint-ignore no-explicit-any
async function getPostmarkClient(): Promise<any> {
  if (client) return client;
  const env = loadEnv();
  if (!env.postmarkServer) {
    throw new Error("Missing POSTMARK_SERVER — required for nightly report.");
  }
  const { ServerClient } = await dynamicImport("postmark");
  client = new ServerClient(env.postmarkServer);
  return client;
}

export interface SendReportParams {
  to?: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  attachments?: Array<{
    Name: string;
    Content: string; // base64
    ContentType: string;
  }>;
}

export async function sendReport(p: SendReportParams): Promise<void> {
  const c = await getPostmarkClient();
  await c.sendEmail({
    From: POSTMARK_FROM_ADDRESS,
    To: p.to ?? POSTMARK_DEFAULT_TO,
    Subject: p.subject,
    HtmlBody: p.htmlBody,
    TextBody: p.textBody,
    Attachments: p.attachments?.map((a) => ({ ...a, ContentID: null })),
  });
}

// deno-lint-ignore no-explicit-any
export function setPostmarkClientForTests(c: any): void {
  client = c;
}
