// Runs once when the server starts (Next.js instrumentation hook, enabled in next.config.js).
// The Node-only check lives in instrumentation-node.ts so the Edge build never sees ssh2.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
