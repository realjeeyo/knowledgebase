import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { getFileStore } from '@/lib/fileStoreInstance'
import { StorageUnavailableError } from '@/lib/fileStore.mjs'
import { readLegacyUpload, uploadKeyFromSegments } from '@/lib/uploads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: { path: string[] }
}

const IMMUTABLE = 'public, max-age=31536000, immutable'
const NO_STORE = 'no-store'

/** GET /uploads/<id>.<ext>  (and <yyyy>/<mm>/<id>.<ext> from the old local backend)
 *
 *  Streams the image from the file store (lib/fileStore.mjs: SFTP to nuvho-vectordb in
 *  production). Names are random per upload, so responses are cached as immutable and
 *  Cloudflare in front of knowledge.nuvho.com serves repeat requests from its edge.
 *  Uploads are public once an article is published, so there is no session check.
 *  Errors are never cached, so a file that arrives later (or storage that recovers) shows up. */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const key = uploadKeyFromSegments(params.path)
  if (!key) return notFound()

  const etag = `"${key.split('/').pop()}"`
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': IMMUTABLE } })
  }

  let storeError: unknown = null
  try {
    const file = await getFileStore().get(key)
    if (file) {
      file.body.on('error', err => console.error('[uploads GET] stream failed', key, err))
      return new NextResponse(Readable.toWeb(file.body) as ReadableStream<Uint8Array>, {
        headers: {
          'Content-Type': file.contentType,
          'Content-Length': String(file.contentLength),
          'Last-Modified': file.modified.toUTCString(),
          ETag: etag,
          'Cache-Control': IMMUTABLE,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
  } catch (err) {
    storeError = err
    console.error('[uploads GET] file store', key, err)
  }

  // Transition only: the image may still be in its old database row (see lib/uploads.ts)
  try {
    const legacy = await readLegacyUpload(key)
    if (legacy) {
      return new NextResponse(new Uint8Array(legacy.data), {
        headers: {
          'Content-Type': legacy.mime,
          'Content-Length': String(legacy.size),
          'Last-Modified': legacy.createdAt.toUTCString(),
          ETag: etag,
          'Cache-Control': IMMUTABLE,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
  } catch (err) {
    console.error('[uploads GET] database fallback', key, err)
  }

  if (storeError) {
    const unavailable = storeError instanceof StorageUnavailableError
    return new NextResponse(unavailable ? 'Image storage is unavailable' : 'Could not read the image', {
      status: unavailable ? 502 : 500,
      headers: { 'Cache-Control': NO_STORE },
    })
  }
  return notFound()
}

function notFound() {
  return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': NO_STORE } })
}
