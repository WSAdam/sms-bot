// Firebase Admin SDK initialization.
//
// IMPORTANT: We construct the dynamic-import call via `new Function(...)` so
// the import expression is invisible to Vite's static analyzer. With a literal
// `await import("firebase-admin/...")` (or even `await import(/* @vite-ignore */ ...)`)
// the @fresh/plugin-vite Deno loader still resolves the specifier and inlines
// firebase-admin's CJS source into the SSR bundle. The bundled CJS then
// references the Node ambient `module` global, which doesn't exist in Deno
// Deploy's ESM runtime — every route touching Firestore 500s with
// "module is not defined".
//
// Wrapping the import call in a Function constructor leaves the resolution
// entirely to Deno at request time, which uses the import map in deno.json
// to load the package via npm:.

import { loadEnv } from "@shared/config/env.ts";

// deno-lint-ignore no-explicit-any
const dynamicImport: (specifier: string) => Promise<any> = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown> as (specifier: string) => Promise<unknown>;

// deno-lint-ignore no-explicit-any
let app: any = null;
// deno-lint-ignore no-explicit-any
let db: any = null;

// deno-lint-ignore no-explicit-any
async function ensureApp(): Promise<any> {
  if (app) return app;

  const env = loadEnv();
  const adminApp = await dynamicImport("firebase-admin/app");

  const existing = adminApp.getApps().find(
    (a: { name: string }) => a.name === "[DEFAULT]",
  );
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
  const adminFs = await dynamicImport("firebase-admin/firestore");
  db = adminFs.getFirestore(adminApp);
  return db;
}

export function resetDbForTests(): void {
  db = null;
  app = null;
}
