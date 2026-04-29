// Firebase Admin SDK initialization. Dynamically imported on first use to
// keep firebase-admin (CJS) out of the module-load graph that Vite SSR sees.
// Without this, every route that transitively imports the wrapper fails with
// "module is not defined" during dev.

import { loadEnv } from "@shared/config/env.ts";

// deno-lint-ignore no-explicit-any
let app: any = null;
// deno-lint-ignore no-explicit-any
let db: any = null;

// deno-lint-ignore no-explicit-any
async function ensureApp(): Promise<any> {
  if (app) return app;

  const env = loadEnv();
  const adminApp = await import("firebase-admin/app");

  const existing = adminApp.getApps().find((a) => a.name === "[DEFAULT]");
  if (existing) {
    app = existing;
    return app;
  }

  let credential;
  if (env.firebaseServiceAccountJson) {
    credential = adminApp.cert(JSON.parse(env.firebaseServiceAccountJson));
  } else if (env.googleApplicationCredentials) {
    const json = JSON.parse(
      await Deno.readTextFile(env.googleApplicationCredentials),
    );
    credential = adminApp.cert(json);
  } else {
    throw new Error("No Firebase credentials available");
  }

  app = adminApp.initializeApp({
    credential,
    projectId: env.firebaseProjectId,
  });
  return app;
}

// deno-lint-ignore no-explicit-any
export async function getDb(): Promise<any> {
  if (db) return db;
  const adminApp = await ensureApp();
  const adminFs = await import("firebase-admin/firestore");
  db = adminFs.getFirestore(adminApp);
  return db;
}

export function resetDbForTests(): void {
  db = null;
  app = null;
}
