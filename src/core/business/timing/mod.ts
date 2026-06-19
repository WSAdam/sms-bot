/** Wrap an async function and log its duration if it exceeds a threshold.
 *  Used to localize slow FS queries in production — wrapping the top-level
 *  repository functions lets prod logs tell us exactly which call is
 *  blowing 5s+ at any moment, instead of guessing from generic abort
 *  errors. Threshold defaults to 1s so we don't flood the log with the
 *  happy path. */
export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
  thresholdMs = 1000,
): Promise<T> {
  const start = Date.now();
  let outcome: "ok" | "err" = "ok";
  try {
    return await fn();
  } catch (err) {
    outcome = "err";
    throw err;
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed >= thresholdMs) {
      console.log(`⏱️  [FS-PROFILE] ${label} took ${elapsed}ms (${outcome})`);
    }
  }
}
