// Next.js instrumentation hook — runs once at server boot, before any
// request is handled. We use it to pre-warm the Swarm alert cache so the
// first user request doesn't trigger a ~30s cold Mantaray traversal that
// Railway's edge proxy times out at ~30s.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmSwarmCache } = await import("./lib/load-alerts");
  warmSwarmCache().catch((err) => {
    console.warn("[instrumentation] pre-warm failed (non-fatal)", err);
  });
}
