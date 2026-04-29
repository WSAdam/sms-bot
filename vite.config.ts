import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

// Mark CJS-heavy npm packages as SSR-external so Vite leaves them as runtime
// imports (resolved by Deno via `npm:` at request time) instead of bundling
// them. Without this, Deno Deploy serves chunks that reference `module` /
// `require` at top level and every API route 500s with "module is not defined".
export default defineConfig({
  plugins: [fresh()],
  ssr: {
    external: [
      "firebase-admin",
      "firebase-admin/app",
      "firebase-admin/firestore",
      "postmark",
    ],
  },
});
