import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

const SESSION_COOKIE = 'nuvho_session'
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'nuvho-kb-dev-secret-change-in-production'
)

export interface SessionPayload {
  userId: number
  email: string
  name: string
  role: string
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

export async function signToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

// ─── Session cookie ───────────────────────────────────────────────────────────

export async function createSession(payload: SessionPayload) {
  const token = await signToken(payload)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null
  return verifyToken(token)
}

export async function clearSession() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

/** Read session from a Next.js request (middleware-safe). */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  return verifyToken(token)
}

// ─── Staff accounts ───────────────────────────────────────────────────────────

/** Staff emails get admin access (app/admin/page.tsx), so they may only be created via Microsoft. */
export function isStaffEmail(email: string): boolean {
  return email.toLowerCase().trim().endsWith('@nuvho.com')
}

// ─── Temporary passwords ──────────────────────────────────────────────────────

const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'

/** A random 16-character password for admin-initiated resets. Shown once; never stored. */
export function generateTempPassword(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_CHARS[bytes[i] % TEMP_PASSWORD_CHARS.length]
  }
  return out
}
