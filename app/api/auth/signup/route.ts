import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { createSession, isStaffEmail } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json()

    // Validate inputs
    if (!name?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
    }
    // Staff addresses grant admin access, so they must prove ownership via Microsoft.
    if (isStaffEmail(email)) {
      return NextResponse.json(
        { error: 'Nuvho staff sign in with their Microsoft account.', useMicrosoft: true },
        { status: 403 }
      )
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    // Check for existing user
    const existing = await pool.query(
      'SELECT id FROM nuvho_kb.users WHERE email = $1',
      [email.toLowerCase().trim()]
    )
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }

    // Hash password and insert
    const password_hash = await bcrypt.hash(password, 12)
    const result = await pool.query(
      `INSERT INTO nuvho_kb.users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, role`,
      [name.trim(), email.toLowerCase().trim(), password_hash]
    )
    const user = result.rows[0]

    // Create session
    await createSession({ userId: user.id, email: user.email, name: user.name, role: user.role })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('[auth/signup]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
