import { createRemoteJWKSet, jwtVerify } from 'jose'

// Sign in with Microsoft (Entra ID) — mirrors nuvho-onboarding-ui/api: the browser runs
// the MSAL popup, then posts the result here for the server to check before a KB session
// is issued. Unlike onboarding (which calls Graph /me with an access token), we verify the
// ID token itself: signature against the tenant's keys, audience = our client ID, tenant =
// ours. A Graph token minted for any other app would pass a /me call, but not this.

export interface MicrosoftConfig {
  clientId: string
  tenantId: string
  /** Optional — when set, only emails at this domain may sign in (e.g. "nuvho.com"). */
  allowedDomain: string
}

export interface MicrosoftIdentity {
  oid: string
  email: string
  name: string
}

/** Read at request time so App Platform env changes apply without a rebuild. */
export function getMicrosoftConfig(): MicrosoftConfig | null {
  const clientId = process.env.AZURE_CLIENT_ID?.trim() ?? ''
  const tenantId = process.env.AZURE_TENANT_ID?.trim() ?? ''
  if (!clientId || !tenantId) return null
  return {
    clientId,
    tenantId,
    allowedDomain: (process.env.AZURE_ALLOWED_DOMAIN ?? '').trim().toLowerCase(),
  }
}

/** The subset the browser needs to start the popup. Both values are public by design. */
export function getMicrosoftClientConfig(): { clientId: string; tenantId: string } | null {
  const config = getMicrosoftConfig()
  return config ? { clientId: config.clientId, tenantId: config.tenantId } : null
}

// One key set per tenant, cached by jose (refetched on unknown `kid`).
const jwksByTenant = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(tenantId: string) {
  let jwks = jwksByTenant.get(tenantId)
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    )
    jwksByTenant.set(tenantId, jwks)
  }
  return jwks
}

export class MicrosoftAuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message)
  }
}

/** Verify an MSAL ID token and return who it identifies. Throws MicrosoftAuthError. */
export async function verifyMicrosoftIdToken(
  idToken: string,
  config: MicrosoftConfig
): Promise<MicrosoftIdentity> {
  let claims: Record<string, unknown>
  try {
    const { payload } = await jwtVerify(idToken, getJwks(config.tenantId), {
      issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
      audience: config.clientId,
      clockTolerance: 60,
    })
    claims = payload
  } catch {
    throw new MicrosoftAuthError('Microsoft sign-in could not be verified.', 401)
  }

  // The issuer check already pins the tenant; `tid` is checked as well for belt and braces.
  if (claims.tid !== config.tenantId || typeof claims.oid !== 'string') {
    throw new MicrosoftAuthError('This Microsoft account is not part of the Nuvho organisation.', 403)
  }

  const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase().trim()
  if (!email.includes('@')) {
    throw new MicrosoftAuthError('Your Microsoft account has no email address.', 403)
  }
  if (config.allowedDomain && !email.endsWith(`@${config.allowedDomain}`)) {
    throw new MicrosoftAuthError('This account does not have access to the Knowledge Base.', 403)
  }

  return {
    oid: claims.oid,
    email,
    name: String(claims.name ?? '').trim() || email.split('@')[0],
  }
}
