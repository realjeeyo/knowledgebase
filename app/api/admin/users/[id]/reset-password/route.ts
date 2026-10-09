import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { getSession, generateTempPassword } from '@/lib/auth'

interface RouteParams {
  params: { id: string }
}

/** POST /api/admin/users/:id/reset-password — set a fresh random password for a user */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await getSession()
  if (!session || !session.email.endsWith('@nuvho.com')) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const userId = Number(params.id)
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 })
  }

  try {
    const newPassword = generateTempPassword()
    const password_hash = await bcrypt.hash(newPassword, 12)

    const result = await pool.query(
      `UPDATE nuvho_kb.users SET password_hash = $1 WHERE id = $2
       RETURNING id, name, email, role`,
      [password_hash, userId]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    return NextResponse.json({ user: result.rows[0], newPassword })
  } catch (err) {
    console.error('[admin/users reset-password]', err)
    return NextResponse.json({ error: 'Failed to reset password.' }, { status: 500 })
  }
}
