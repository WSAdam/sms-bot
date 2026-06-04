// Firebase ID token verification via the Identity Toolkit REST API.
//
// We could verify JWTs locally against Google's rotating RSA public keys,
// but that's ~150 LoC of SubtleCrypto + X.509 cert parsing in Deno. The
// REST `accounts:lookup` endpoint does the same verification server-side
// and returns the user's email + verified flag. This only fires ONCE at
// login (then we mint our own session cookie), so the network hop is fine.

const LOOKUP_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

export interface FirebaseUserInfo {
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  uid: string;
}

export interface VerifyOk {
  ok: true;
  user: FirebaseUserInfo;
}

export interface VerifyErr {
  ok: false;
  reason: string;
}

export type VerifyResult = VerifyOk | VerifyErr;

interface LookupResponse {
  users?: Array<{
    localId?: string;
    email?: string;
    emailVerified?: boolean;
    displayName?: string;
  }>;
  error?: { message?: string };
}

export async function verifyFirebaseIdToken(
  idToken: string,
  firebaseApiKey: string,
): Promise<VerifyResult> {
  if (!idToken) return { ok: false, reason: "missing-id-token" };

  let res: Response;
  try {
    res = await fetch(`${LOOKUP_URL}?key=${encodeURIComponent(firebaseApiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
  } catch (e) {
    return { ok: false, reason: `network: ${(e as Error).message}` };
  }

  let body: LookupResponse;
  try {
    body = await res.json() as LookupResponse;
  } catch {
    return { ok: false, reason: `bad-json http=${res.status}` };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: `http=${res.status} ${body.error?.message ?? "unknown"}`,
    };
  }

  const user = body.users?.[0];
  if (!user || !user.email) {
    return { ok: false, reason: "no-user-in-response" };
  }

  return {
    ok: true,
    user: {
      email: user.email.toLowerCase(),
      emailVerified: user.emailVerified === true,
      displayName: user.displayName ?? null,
      uid: user.localId ?? "",
    },
  };
}
