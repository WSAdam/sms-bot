// Wrapper around the npm:postmark ServerClient. Lazy-instantiated.
// Tests should mock this module entirely (do not call real Postmark).

import { ServerClient } from "postmark";
import {
  POSTMARK_DEFAULT_TO,
  POSTMARK_FROM_ADDRESS,
} from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";

let client: ServerClient | null = null;

function getPostmarkClient(): ServerClient {
  if (client) return client;
  const env = loadEnv();
  if (!env.postmarkServer) {
    throw new Error("Missing POSTMARK_SERVER — required for nightly report.");
  }
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
  await getPostmarkClient().sendEmail({
    From: POSTMARK_FROM_ADDRESS,
    To: p.to ?? POSTMARK_DEFAULT_TO,
    Subject: p.subject,
    HtmlBody: p.htmlBody,
    TextBody: p.textBody,
    Attachments: p.attachments?.map((a) => ({ ...a, ContentID: null })),
  });
}

export function setPostmarkClientForTests(c: ServerClient | null): void {
  client = c;
}
