// Module barrel for `auth` (Firebase ID-token + session-cookie auth).
export {
  type FirebaseUserInfo,
  type VerifyErr,
  verifyFirebaseIdToken,
  type VerifyOk,
  type VerifyResult,
} from "@auth/domain/data/firebase/mod.ts";
export {
  buildClearCookie,
  buildSetCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  type SessionPayload,
  signSession,
  verifySession,
} from "@auth/domain/business/session/mod.ts";
export { verifyCanaryBearer } from "@auth/domain/business/bearer/mod.ts";
export {
  type AuthConfig,
  getAuthConfig,
  isDomainAllowed,
} from "@auth/domain/business/auth-config/mod.ts";
export {
  authGate,
  isPublicPath,
} from "@auth/domain/business/middleware/mod.ts";
