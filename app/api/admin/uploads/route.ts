import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, saveUpload, sniffType } from '@/lib/uploads'
import { storageFailure } from '@/lib/fileStore.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/admin/uploads
 *  multipart/form-data with one `file` field. Images only, MAX_UPLOAD_MB cap (default 10).
 *  Restricted to @nuvho.com sessions, like every other write route.
 *  Returns { location, url, filename, size, type } — `location` follows the TinyMCE
 *  upload-handler convention; our own code reads `url`.
 *
 *  Deployment note: nginx in front of the container must allow bodies of at least
 *  MAX_UPLOAD_MB (client_max_body_size), otherwise it answers 413 before we do. */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.email.endsWith('@nuvho.com')) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  // Cheap early reject when the browser declares the size (allow for multipart overhead).
  const declared = Number(req.headers.get('content-length'))
  if (declared && declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: `Images must be ${MAX_UPLOAD_MB} MB or smaller.` }, { status: 413 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file was included in the request.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Images must be ${MAX_UPLOAD_MB} MB or smaller.` }, { status: 413 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const mime = sniffType(buf)
  if (!mime || !ALLOWED_TYPES[mime]) {
    return NextResponse.json({ error: 'Only JPG, PNG, WebP and GIF images are accepted.' }, { status: 415 })
  }

  try {
    const saved = await saveUpload(buf, mime, session.email)
    return NextResponse.json({
      location: saved.url,
      url: saved.url,
      filename: saved.filename,
      size: buf.length,
      type: mime,
      // 'sftp' in production, 'local' in development (lib/fileStore.mjs)
      backend: saved.backend,
    })
  } catch (err) {
    console.error('[admin/uploads POST]', err)
    const failure = storageFailure(err)
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status })
    return NextResponse.json({ error: 'Could not store the file on the server.' }, { status: 500 })
  }
}
