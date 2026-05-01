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

// We cache the in-flight Promise — not just the resolved value — so concurrent
// callers during cold start all await the same single initialization. Without
// this, two requests racing through getDb() before the first finishes would
// each call db.settings({preferRest:true}); the second throws "Firestore has
// already been initialized. You can only call settings() once".
// deno-lint-ignore no-explicit-any
let appPromise: Promise<any> | null = null;
// deno-lint-ignore no-explicit-any
let dbPromise: Promise<any> | null = null;

// deno-lint-ignore no-explicit-any
function ensureApp(): Promise<any> {
  if (appPromise) return appPromise;
  appPromise = (async () => {
    const env = loadEnv();
    const adminApp = await dynamicImport("firebase-admin/app");

    const existing = adminApp.getApps().find(
      (a: { name: string }) => a.name === "[DEFAULT]",
    );
    if (existing) return existing;

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

    return adminApp.initializeApp({
      credential,
      projectId: env.firebaseProjectId,
    });
  })();
  return appPromise;
}

// deno-lint-ignore no-explicit-any
export function getDb(): Promise<any> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const adminApp = await ensureApp();
    const adminFs = await dynamicImport("firebase-admin/firestore");
    const instance = adminFs.getFirestore(adminApp);
    // Force REST transport. Deno Deploy doesn't reliably support the long-lived
    // HTTP/2 gRPC streams the Firestore SDK uses by default — without this
    // every call 500s after ~50s with "14 UNAVAILABLE: No connection
    // established". Must run once, before any other Firestore op.
    instance.settings({ preferRest: true });
    return instance;
  })();
  return dbPromise;
}

export function resetDbForTests(): void {
  appPromise = null;
  dbPromise = null;
}
