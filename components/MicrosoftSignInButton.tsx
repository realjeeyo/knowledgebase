'use client'

import { useEffect, useRef, useState } from 'react'
import type { IPublicClientApplication } from '@azure/msal-browser'

export interface MicrosoftClientConfig {
  clientId: string
  tenantId: string
}

interface Props {
  config: MicrosoftClientConfig
  disabled?: boolean
  /** Signed in and the next page is loading — keep the spinner up. */
  redirecting?: boolean
  onBusyChange?: (busy: boolean) => void
  onError: (message: string) => void
  onSuccess: () => void
}

// "Sign in with Microsoft" — the same popup flow as nuvho-onboarding-ui (Login.jsx):
// MSAL opens the Microsoft popup, then the server verifies the ID token
// (/api/auth/microsoft) and sets the KB session cookie.
export default function MicrosoftSignInButton({ config, disabled, redirecting = false, onBusyChange, onError, onSuccess }: Props) {
  // Callers pass a fresh onError each render; keep the latest without re-initialising MSAL
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const msal = useRef<IPublicClientApplication | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  // MSAL loads and initialises up front: loginPopup must run straight from the click,
  // or the browser treats the popup as unsolicited and blocks it.
  useEffect(() => {
    let cancelled = false
    import('@azure/msal-browser')
      .then(({ createStandardPublicClientApplication }) =>
        createStandardPublicClientApplication({
          auth: {
            clientId: config.clientId,
            authority: `https://login.microsoftonline.com/${config.tenantId}`,
            redirectUri: `${window.location.origin}/auth/callback`,
          },
          cache: { cacheLocation: 'sessionStorage' },
        })
      )
      .then(instance => {
        if (cancelled) return
        msal.current = instance
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current('Microsoft sign-in could not load. Refresh the page and try again.')
      })
    return () => { cancelled = true }
  }, [config.clientId, config.tenantId])

  function setBusyBoth(value: boolean) {
    setBusy(value)
    onBusyChange?.(value)
  }

  async function handleClick() {
    if (!msal.current) return
    onError('')
    setBusyBoth(true)
    try {
      let idToken: string
      try {
        const result = await msal.current.loginPopup({
          scopes: ['openid', 'profile', 'email'],
          prompt: 'select_account',
        })
        idToken = result.idToken
      } catch (err) {
        const code = (err as { errorCode?: string }).errorCode
        if (code === 'user_cancelled') return // popup closed — no error shown
        if (code === 'popup_window_error' || code === 'empty_window_error') {
          onError('Your browser blocked the Microsoft sign-in window. Allow pop-ups for this site and try again.')
        } else {
          onError(`Microsoft sign-in error: ${(err as Error).message || code || 'unknown'}`)
        }
        return
      }

      const res = await fetch('/api/auth/microsoft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        onError(data.error ?? `Sign-in failed (${res.status}). Contact support.`)
        return
      }
      onSuccess()
    } catch {
      onError('Something went wrong. Please try again.')
    } finally {
      setBusyBoth(false)
    }
  }

  return (
    <button
      type="button"
      className="nv-auth__ms"
      onClick={handleClick}
      disabled={disabled || busy || !ready}
      aria-busy={busy || redirecting || !ready}
    >
      {busy || redirecting || !ready ? (
        <span className="nv-spin" aria-hidden="true" />
      ) : (
        <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
          <rect width="10" height="10" fill="#F25022" />
          <rect x="11" width="10" height="10" fill="#7FBA00" />
          <rect y="11" width="10" height="10" fill="#00A4EF" />
          <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
        </svg>
      )}
      {redirecting ? 'Signing in…' : busy ? 'Waiting for Microsoft…' : 'Sign in with Microsoft'}
    </button>
  )
}
