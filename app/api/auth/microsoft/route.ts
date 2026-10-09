import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { createSession } from '@/lib/auth'
import { getMicrosoftConfig, verifyMicrosoftIdToken, MicrosoftAuthError } from '@/lib/microsoft'

interface UserRow {
  id: number
  name: string
  email: string
  role: string
  azure_oid: string | null
}

// POST { idToken } — the MSAL popup result from /login. Same shape as onboarding's
// /auth/azure/validate: verify, find the user by Entra object ID then email,
// auto-provision on first sign-in, then issue the usual KB session cookie.
export async function POST(req: NextRequest) {
  const config = getMicrosoftConfig()
  if (!config) {
    return NextResponse.json({ error: 'Microsoft sign-in is not configured.' }, { status: 404 })
  }

  try {
    const { idToken } = await req.json()
    if (typeof idToken !== 'string' || !idToken) {
      return NextResponse.json({ error: 'Missing Microsoft token.' }, { status: 400 })
    }

    const identity = await verifyMicrosoftIdToken(idToken, config)

    let user: UserRow | undefined = (
      await pool.query<UserRow>(
        'SELECT id, name, email, role, azure_oid FROM nuvho_kb.users WHERE azure_oid = $1',
        [identity.oid]
      )
    ).rows[0]

    if (!user) {
      user = (
        await pool.query<UserRow>(
          'SELECT id, name, email, role, azure_oid FROM nuvho_kb.users WHERE email = $1',
          [identity.email]
        )
      ).rows[0]
      // An email match already linked to a different Microsoft account must not be taken over.
      if (user?.azure_oid && user.azure_oid !== identity.oid) {
        return NextResponse.json(
          { error: 'This email is linked to a different Microsoft account. Contact an administrator.' },
          { status: 409 }
        )
      }
    }

    if (user) {
      user = (
        await pool.query<UserRow>(
          `UPDATE nuvho_kb.users
              SET azure_oid = $1, email = $2
            WHERE id = $3
            RETURNING id, name, email, role, azure_oid`,
          [identity.oid, identity.email, user.id]
        )
      ).rows[0]
    } else {
      user = (
        await pool.query<UserRow>(
          `INSERT INTO nuvho_kb.users (name, email, azure_oid)
           VALUES ($1, $2, $3)
           RETURNING id, name, email, role, azure_oid`,
          [identity.name, identity.email, identity.oid]
        )
      ).rows[0]
    }

    await createSession({ userId: user.id, email: user.email, name: user.name, role: user.role })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof MicrosoftAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    // Unique email violation: the Microsoft email changed to one another KB account holds.
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'Another Knowledge Base account already uses this email. Contact an administrator.' },
        { status: 409 }
      )
    }
    console.error('[auth/microsoft]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
