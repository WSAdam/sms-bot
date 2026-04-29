import { App, staticFiles } from "fresh";
import { type State } from "./utils.ts";

export const app = new App<State>();

app.use(staticFiles());

// All cross-cutting middleware (CORS, error envelope, ET access log) lives in
// routes/_middleware.ts so it runs in the file-system pipeline.

app.fsRoutes();
