'use client'

import { useEffect, useState } from 'react'

// Redirect URI for the Microsoft sign-in popup (register it in Entra as a SPA redirect
// URI). MSAL v5 needs this page to hand the response back to the window that opened it;
// the popup then closes itself.
export default function MicrosoftCallbackPage() {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    import('@azure/msal-browser/redirect-bridge')
      .then(({ broadcastResponseToMainFrame }) => broadcastResponseToMainFrame())
      .catch(() => setFailed(true))
  }, [])

  return (
    <main className="nv-auth__callback" role="status" aria-live="polite">
      {failed ? (
        <p>Sign-in could not be completed. You can close this window and try again.</p>
      ) : (
        <>
          <span className="nv-spin" aria-hidden="true" />
          <p>Completing sign-in…</p>
        </>
      )}
    </main>
  )
}
