import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'

/** GET /api/admin/users?q=<search> — list users, optionally filtered by name/email */
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.email.endsWith('@nuvho.com')) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  try {
    const q = req.nextUrl.searchParams.get('q')?.trim()
    const result = q
      ? await pool.query(
          `SELECT id, name, email, role, created_at FROM nuvho_kb.users
           WHERE name ILIKE $1 OR email ILIKE $1
           ORDER BY name ASC`,
          [`%${q}%`]
        )
      : await pool.query(
          `SELECT id, name, email, role, created_at FROM nuvho_kb.users ORDER BY name ASC`
        )
    return NextResponse.json(result.rows)
  } catch (err) {
    console.error('[admin/users GET]', err)
    return NextResponse.json({ error: 'Failed to fetch users.' }, { status: 500 })
  }
}
