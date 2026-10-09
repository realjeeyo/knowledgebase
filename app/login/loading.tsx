// Sign-in has no site header — a plain spinner on the auth surface.
export default function Loading() {
  return (
    <main className="nv-auth__callback" role="status" aria-live="polite">
      <span className="nv-spin" aria-hidden="true" />
      <span className="sr-only">Loading sign-in…</span>
    </main>
  )
}
