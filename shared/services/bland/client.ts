// Bland.ai SMS client. Thin wrappers over fetch — every method takes a
// fully-formed payload and returns the parsed JSON.

import { BLAND_API_BASE } from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";

interface BlandHeaders {
  [key: string]: string;
}

function authHeader(): BlandHeaders {
  const env = loadEnv();
  const key = env.blandApiKey || env.blandFallbackApiKey;
  if (!key) throw new Error("Missing BLAND_API_KEY (or NU_BLAND_API_KEY)");
  return { authorization: key };
}

export interface CreateConversationParams {
  user_number: string;
  agent_number: string;
  pathway_id: string;
  pathway_version: string;
  new_conversation: boolean;
  request_data: Record<string, unknown>;
}

export interface CreateConversationResult {
  data?: { conversation_id?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export async function createConversation(
  params: CreateConversationParams,
): Promise<CreateConversationResult> {
  const res = await fetch(BLAND_API_BASE, {
    method: "POST",
    headers: { ...authHeader(), "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  return await res.json() as CreateConversationResult;
}

// Plain SMS send — bypasses any pathway, sends `agent_message` verbatim.
// Used by the /trigger/test-sms QA endpoint so we can preview specific text
// to a real phone without authoring a Bland pathway.
// Endpoint: https://api.bland.ai/v1/sms/send
export interface SendSmsParams {
  user_number: string;     // E.164 destination
  agent_number: string;    // E.164 sender (must be a number on your Bland account)
  agent_message: string;   // raw message text
  new_conversation?: boolean;
  request_data?: Record<string, unknown>;
}

export async function sendSms(
  params: SendSmsParams,
): Promise<{ status: number; ok: boolean; json: unknown }> {
  const url = BLAND_API_BASE.replace(/\/conversations$/, "/send");
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeader(), "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  return { status: res.status, ok: res.ok, json };
}

export interface BlandConvoResponse {
  data?: {
    user_number?: string;
    message_count?: number;
    created_at?: string;
    messages?: Array<{ sender: string; message: string; created_at?: string }>;
  };
  errors?: unknown;
}

export async function getConversation(
  conversationId: string,
): Promise<{ status: number; ok: boolean; json: BlandConvoResponse }> {
  const res = await fetch(`${BLAND_API_BASE}/${conversationId}`, {
    headers: authHeader(),
  });
  const json = await res.json();
  return { status: res.status, ok: res.ok, json };
}

export interface BlandListItem {
  id: string;
  user_number: string;
  message_count: number;
  created_at: string;
}

export async function listConversationsToday(): Promise<
  { from: string; conversations: BlandListItem[] }
> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const filters = JSON.stringify([
    { field: "created_at", operator: "gte", value: todayStart.toISOString() },
  ]);

  const all: BlandListItem[] = [];
  let page = 1;
  while (true) {
    const url = new URL(BLAND_API_BASE);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("sortBy", "created_at");
    url.searchParams.set("sortDir", "asc");
    url.searchParams.set("filters", filters);

    const res = await fetch(url.toString(), { headers: authHeader() });
    const json = await res.json();
    if (!res.ok || !json?.data) {
      throw new Error(`Bland list ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    }
    for (const c of json.data as BlandListItem[]) all.push(c);
    if (page >= (json.extra?.pagination?.totalPages ?? 1)) break;
    page++;
  }
  return { from: todayStart.toISOString(), conversations: all };
}
