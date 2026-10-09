import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { createSession } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email?.trim() || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
    }

    // Look up user
    const result = await pool.query(
      'SELECT id, name, email, password_hash, role FROM nuvho_kb.users WHERE email = $1',
      [email.toLowerCase().trim()]
    )
    const user = result.rows[0]

    // Constant-time comparison — same error for unknown email vs wrong password
    // Accounts created by Microsoft sign-in have no password until an admin resets one
    if (user && !user.password_hash) {
      return NextResponse.json(
        { error: 'This account signs in with Microsoft. Use “Sign in with Microsoft” below.' },
        { status: 401 }
      )
    }
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false
    if (!user || !valid) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
    }

    // Create session
    await createSession({ userId: user.id, email: user.email, name: user.name, role: user.role })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[auth/login]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
