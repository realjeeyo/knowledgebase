// Where uploaded image files live (decision 2026-11-09, same design as Nuvho Onboarding's
// src/services/fileStore.js). Every image save, read and delete goes through a store from
// createFileStore(); nothing else touches the files directly.
//
//   sftp  — plain files on nuvho-vectordb (the KB database droplet), reached over the
//           private VPC as the chrooted, key-only, SFTP-only user kb-files on port 2222.
//           The server's ed25519 host key is pinned and checked on every connection.
//           Production uses this.
//   local — files under UPLOADS_DIR. Development and tests only: App Platform wipes the
//           container disk on every deploy, so production refuses it.
//
// Postgres keeps only metadata (nuvho_kb.uploads: id, ext, mime, size, uploaded_by,
// created_at). Keys are relative paths such as "mw4ninev-ea1b85c9a021.jpg"; the public URL
// is "/uploads/" + key, served by app/uploads/[...path]/route.ts.
//
// Plain ESM (with JSDoc types) so both the Next.js app and scripts/import-image-library.mjs
// can use it without a TypeScript step.

import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import ssh2 from 'ssh2'

const { Client, utils } = ssh2

export const UPLOADS_PREFIX = '/uploads/'
const CONNECT_TIMEOUT_MS = 5000
const OP_TIMEOUT_MS = 30000
const READ_CHUNK = 256 * 1024
const FREE_SPACE_CACHE_MS = 60 * 1000
const DEFAULT_MIN_FREE_BYTES = 5 * 1024 ** 3   // 5 GB
const SFTP_EOF = 1
const SFTP_NO_SUCH_FILE = 2
const SFTP_FAILURE = 4                         // generic server-side failure, e.g. a full disk

export const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** @param {string} key */
export const contentTypeOf = (key) =>
  CONTENT_TYPES[path.posix.extname(key).slice(1).toLowerCase()] || 'application/octet-stream'

export class StorageUnavailableError extends Error {
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message)
    this.name = 'StorageUnavailableError'
    this.cause = cause
  }
}

export class StorageFullError extends Error {
  constructor() {
    super('File storage is nearly full')
    this.name = 'StorageFullError'
  }
}

export class StorageConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'StorageConfigError'
  }
}

/** A safe relative key: no empty, "." or ".." segments, no backslashes or NULs, not absolute.
 *  @param {unknown} key @returns {key is string} */
export function isSafeKey(key) {
  if (typeof key !== 'string' || !key || key.startsWith('/') || key.includes('\\') || key.includes('\0')) return false
  return key.split('/').every(seg => seg && seg !== '.' && seg !== '..')
}

/** @param {string} key */
function assertKey(key) {
  if (!isSafeKey(key)) throw new Error(`Invalid file key: ${JSON.stringify(key)}`)
}

/**
 * @typedef {{ contentLength: number, modified: Date }} FileInfo
 * @typedef {{ body: import('stream').Readable, contentType: string, contentLength: number, modified: Date }} StoredFile
 * @typedef {{
 *   driver: 'local' | 'sftp',
 *   put(key: string, buffer: Buffer): Promise<void>,
 *   head(key: string): Promise<FileInfo | null>,
 *   get(key: string): Promise<StoredFile | null>,
 *   remove(key: string): Promise<void>,
 *   close(): void,
 * }} FileStore
 */

// ── local ────────────────────────────────────────────────────────────────────

/** @param {{ UPLOADS_DIR?: string }} cfg @returns {FileStore} */
function localDriver(cfg) {
  const root = path.resolve(cfg.UPLOADS_DIR || path.join(process.cwd(), 'uploads'))
  /** @param {string} key */
  const full = (key) => {
    assertKey(key)
    const p = path.resolve(root, key)
    if (!p.startsWith(root + path.sep)) throw new Error(`Invalid file key: ${JSON.stringify(key)}`)
    return p
  }
  /** @param {any} err */
  const missing = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR'

  /** @param {string} key @returns {Promise<FileInfo | null>} */
  async function head(key) {
    try {
      const st = await fsp.stat(full(key))
      return st.isFile() ? { contentLength: st.size, modified: st.mtime } : null
    } catch (err) {
      if (missing(err)) return null
      throw err
    }
  }

  return {
    driver: 'local',
    async put(key, buffer) {
      const p = full(key)
      await fsp.mkdir(path.dirname(p), { recursive: true })
      await fsp.writeFile(p, buffer, { flag: 'wx' })   // never overwrite an existing image
    },
    head,
    async get(key) {
      const info = await head(key)
      if (!info) return null
      return { body: fs.createReadStream(full(key)), contentType: contentTypeOf(key), ...info }
    },
    async remove(key) {
      try {
        await fsp.unlink(full(key))
      } catch (err) {
        if (!missing(err)) throw err
      }
    },
    close() {},
  }
}

// ── sftp ─────────────────────────────────────────────────────────────────────

const SFTP_SETTINGS = ['SFTP_HOST', 'SFTP_USER', 'SFTP_PRIVATE_KEY_B64', 'SFTP_HOST_KEY_SHA256', 'SFTP_ROOT']

class OperationTimeout extends Error {}

/** Accepts the bare fingerprint, "SHA256:…", or a whole `ssh-keygen -lf` line
 *  ("256 SHA256:… root@host (ED25519)"). Returns the base64 part without padding.
 *  @param {string} value */
export function normaliseFingerprint(value) {
  const m = String(value).match(/SHA256:([A-Za-z0-9+/]+=*)/)
  const raw = m ? m[1] : String(value).trim()
  return raw.replace(/=+$/, '')
}

/**
 * @param {Record<string, string | undefined> & { opTimeoutMs?: number }} cfg
 * @returns {FileStore & { _connections(): number }}
 */
function sftpDriver(cfg) {
  for (const name of SFTP_SETTINGS) {
    if (!cfg[name]) throw new StorageConfigError(`Missing storage setting: ${name}`)
  }
  const privateKey = Buffer.from(/** @type {string} */ (cfg.SFTP_PRIVATE_KEY_B64), 'base64')
  // Catch a bad or passphrase-protected key at boot, not at the first upload
  const parsed = utils.parseKey(privateKey)
  if (parsed instanceof Error || (Array.isArray(parsed) && !parsed.length)) {
    throw new StorageConfigError('Invalid storage setting: SFTP_PRIVATE_KEY_B64 is not a usable private key')
  }
  const expectedHostKey = normaliseFingerprint(/** @type {string} */ (cfg.SFTP_HOST_KEY_SHA256))
  if (!/^[A-Za-z0-9+/]{43}$/.test(expectedHostKey)) {
    throw new StorageConfigError('Invalid storage setting: SFTP_HOST_KEY_SHA256 is not a SHA256 fingerprint')
  }
  const port = Number(cfg.SFTP_PORT || 2222)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new StorageConfigError('Invalid storage setting: SFTP_PORT')
  }
  const minFreeBytes = cfg.SFTP_MIN_FREE_BYTES ? Number(cfg.SFTP_MIN_FREE_BYTES) : DEFAULT_MIN_FREE_BYTES
  if (!Number.isFinite(minFreeBytes) || minFreeBytes < 0) {
    throw new StorageConfigError('Invalid storage setting: SFTP_MIN_FREE_BYTES')
  }
  const root = /** @type {string} */ (cfg.SFTP_ROOT).replace(/\/+$/, '') || '/'
  /** @param {string} key */
  const remote = (key) => {
    assertKey(key)
    return `${root === '/' ? '' : root}/${key}`
  }
  const opTimeoutMs = cfg.opTimeoutMs ?? OP_TIMEOUT_MS

  /** @type {Promise<{ client: import('ssh2').Client, sftp: import('ssh2').SFTPWrapper }> | null} */
  let session = null               // the shared connection, while open or opening
  const clients = new Set()        // every connection not yet closed, so close() can end them all
  /** @type {{ bytes: number, at: number } | null} */
  let freeSpace = null

  function connect() {
    if (session) return session
    const client = new Client()
    clients.add(client)
    /** @type {Promise<{ client: import('ssh2').Client, sftp: import('ssh2').SFTPWrapper }>} */
    const current = new Promise((resolve, reject) => {
      client.once('ready', () => client.sftp((err, sftp) => {
        if (err) return reject(err)
        // An unhandled 'error' on the channel would crash the process
        sftp.on('error', forget)
        sftp.on('close', forget)
        resolve({ client, sftp })
      }))
      client.once('error', reject)
    })
    // Forget a connection as soon as it closes, so the next call reconnects
    function forget() { if (session === current) session = null }
    client.on('close', () => { forget(); clients.delete(client) })
    client.on('error', forget)
    current.catch(() => client.end())
    client.connect({
      host: cfg.SFTP_HOST,
      port,
      username: cfg.SFTP_USER,
      privateKey,
      readyTimeout: CONNECT_TIMEOUT_MS,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      algorithms: { serverHostKey: ['ssh-ed25519'] },   // the pinned fingerprint is the ed25519 key
      hostVerifier: (/** @type {Buffer} */ hostKey) => {
        const actual = crypto.createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')
        if (actual !== expectedHostKey) console.error('[fileStore] SFTP host key mismatch — refusing to connect')
        return actual === expectedHostKey
      },
    })
    session = current
    return session
  }

  // Drops a broken connection, but only if it is still the shared one: other requests
  // that failed on the same drop must not discard its replacement.
  /** @param {Promise<any>} current @param {import('ssh2').Client} [client] */
  function drop(current, client) {
    if (session === current) session = null
    client?.end()
  }

  /** @param {any} err */
  const isSftpStatus = (err) => typeof err?.code === 'number'
  /** @param {any} err */
  const notFound = (err) => err?.code === SFTP_NO_SUCH_FILE

  /** @template T @param {Promise<T>} promise @param {number} ms @returns {Promise<T>} */
  function withTimeout(promise, ms) {
    /** @type {NodeJS.Timeout | undefined} */
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new OperationTimeout('SFTP operation timed out')), ms)
    })
    return /** @type {Promise<T>} */ (Promise.race([promise, timeout]).finally(() => clearTimeout(timer)))
  }

  // Runs fn(sftp) on the shared connection. A dropped connection is retried once on a
  // fresh one. A slow operation fails on its own without touching the connection, so
  // other requests and downloads carry on. File-level SFTP errors pass through.
  /** @template T @param {(sftp: import('ssh2').SFTPWrapper) => Promise<T>} fn @param {number} [ms] @returns {Promise<T>} */
  async function run(fn, ms = opTimeoutMs) {
    /** @type {unknown} */
    let lastErr
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = connect()
      let s
      try {
        s = await current
      } catch (err) {
        lastErr = err
        drop(current)
        continue
      }
      try {
        return await withTimeout(fn(s.sftp), ms)
      } catch (err) {
        if (isSftpStatus(err)) throw err
        if (err instanceof OperationTimeout) throw new StorageUnavailableError('File storage timed out', err)
        lastErr = err
        drop(current, s.client)
      }
    }
    throw new StorageUnavailableError('File storage is unavailable', lastErr)
  }

  /** @param {any} sftp @param {string} method @param {...any} args @returns {Promise<any>} */
  const call = (sftp, method, ...args) =>
    new Promise((resolve, reject) => sftp[method](...args, (/** @type {any} */ err, /** @type {any} */ result) => (err ? reject(err) : resolve(result))))

  /** @param {string} key */
  async function stat(key) {
    try {
      return await run(sftp => call(sftp, 'stat', remote(key)))
    } catch (err) {
      if (notFound(err)) return null
      throw err
    }
  }

  async function ensureFreeSpace({ fresh = false } = {}) {
    if (fresh || !freeSpace || Date.now() - freeSpace.at > FREE_SPACE_CACHE_MS) {
      const st = await run(sftp => call(sftp, 'ext_openssh_statvfs', root))
      freeSpace = { bytes: Number(st.f_bavail) * Number(st.f_frsize), at: Date.now() }
    }
    if (freeSpace.bytes < minFreeBytes) throw new StorageFullError()
  }

  /** @param {string} dir */
  async function mkdirs(dir) {
    let current = root === '/' ? '' : root
    for (const seg of dir.split('/').filter(s => s && s !== '.')) {
      current = `${current}/${seg}`
      const target = current
      try {
        await run(sftp => call(sftp, 'mkdir', target))
      } catch (err) {
        if (!isSftpStatus(err)) throw err
        // Fine only if it already exists (or another upload just made it)
        const st = await run(sftp => call(sftp, 'stat', target)).catch(() => null)
        if (!st?.isDirectory()) throw err
      }
    }
  }

  /** @param {string} key */
  async function head(key) {
    const st = await stat(key)
    return st && st.isFile() ? { contentLength: st.size, modified: new Date(st.mtime * 1000) } : null
  }

  return {
    driver: 'sftp',
    async put(key, buffer) {
      const target = remote(key)
      await ensureFreeSpace()
      await mkdirs(path.posix.dirname(key))
      // Keys are random per upload; an existing file means a bug, so never overwrite it
      if (await head(key)) throw new Error(`File already exists: ${key}`)
      try {
        // Allow ~1 MB/s on top of the usual timeout, so a large file isn't cut off
        await run(
          sftp => call(sftp, 'writeFile', target, buffer, { flag: 'w', mode: 0o640 }),
          opTimeoutMs + Math.ceil(buffer.length / 1e6) * 1000,
        )
      } catch (err) {
        // Remove whatever was half-written
        await run(sftp => call(sftp, 'unlink', target)).catch(() => {})
        if (err instanceof StorageUnavailableError) throw err
        // A generic server failure on write is usually a full disk: re-check before saying so
        if (/** @type {any} */ (err)?.code === SFTP_FAILURE) {
          await ensureFreeSpace({ fresh: true }).catch(e => { if (e instanceof StorageFullError) throw e })
        }
        throw new StorageUnavailableError(`Could not save the file (${/** @type {Error} */ (err).message})`, err)
      }
    },
    head,
    async get(key) {
      const info = await head(key)
      if (!info) return null
      const target = remote(key)
      /** @type {{ sftp: import('ssh2').SFTPWrapper, handle: Buffer }} */
      let opened
      try {
        opened = await run(async sftp => ({ sftp, handle: await call(sftp, 'open', target, 'r') }))
      } catch (err) {
        if (notFound(err)) return null   // removed between the stat and the open
        throw err
      }
      const { sftp, handle } = opened
      const size = info.contentLength
      // ssh2's createReadStream issues many small sequential reads, so it is slow on any
      // link with latency; large sequential reads (split by ssh2 into the server's maximum
      // packet size) keep a 2 MB image to a handful of round trips. The handle is closed
      // when the stream ends, fails, or the browser goes away.
      async function* chunks() {
        let pos = 0
        try {
          while (pos < size) {
            const len = Math.min(READ_CHUNK, size - pos)
            const buf = Buffer.allocUnsafe(len)
            /** @type {number} */
            const n = await withTimeout(new Promise((resolve, reject) => {
              sftp.read(handle, buf, 0, len, pos, (err, bytesRead) => {
                if (err && /** @type {any} */ (err).code !== SFTP_EOF) reject(err)
                else resolve(err ? 0 : bytesRead)
              })
            }), opTimeoutMs)
            if (!n) break
            pos += n
            yield n === len ? buf : buf.subarray(0, n)
          }
        } finally {
          try { sftp.close(handle, () => {}) } catch { /* connection already gone */ }
        }
      }
      return { body: Readable.from(chunks()), contentType: contentTypeOf(key), ...info }
    },
    async remove(key) {
      try {
        await run(sftp => call(sftp, 'unlink', remote(key)))
      } catch (err) {
        if (!notFound(err)) throw err
      }
    },
    /** Closes every connection (tests, scripts, shutdown). */
    close() {
      session = null
      for (const client of clients) client.end()
    },
    _connections: () => clients.size,
  }
}

// ── factory ──────────────────────────────────────────────────────────────────

/**
 * Builds a store from settings (normally process.env). Throws StorageConfigError for a
 * missing or invalid setting, so a bad deploy fails at start-up (instrumentation.ts).
 *
 *   UPLOAD_STORAGE           sftp | local   (default: local in development, required in production)
 *   UPLOADS_DIR              local root (default ./uploads)
 *   SFTP_HOST, SFTP_PORT (2222), SFTP_USER, SFTP_ROOT,
 *   SFTP_HOST_KEY_SHA256, SFTP_PRIVATE_KEY_B64, SFTP_MIN_FREE_BYTES (5 GB)
 *
 * @param {Record<string, string | undefined> & { opTimeoutMs?: number }} cfg
 * @returns {FileStore}
 */
export function createFileStore(cfg) {
  const production = cfg.NODE_ENV === 'production'
  const driver = cfg.UPLOAD_STORAGE || (production ? '' : 'local')
  if (driver === 'local') {
    if (production && cfg.UPLOADS_LOCAL_IN_PRODUCTION !== 'true') {
      throw new StorageConfigError(
        'UPLOAD_STORAGE=local is not allowed in production: App Platform wipes the disk on every deploy. ' +
        'Set UPLOAD_STORAGE=sftp (or UPLOADS_LOCAL_IN_PRODUCTION=true on a Docker host with a volume).',
      )
    }
    return localDriver(cfg)
  }
  if (driver === 'sftp') return sftpDriver(cfg)
  if (!driver) {
    throw new StorageConfigError('UPLOAD_STORAGE is not set. Production needs UPLOAD_STORAGE=sftp and the SFTP_* settings.')
  }
  if (driver === 'db') {
    throw new StorageConfigError(
      'UPLOAD_STORAGE=db was removed on 9 Nov 2026: images are files now. Set UPLOAD_STORAGE=sftp and the SFTP_* settings.',
    )
  }
  throw new StorageConfigError(
    `UPLOAD_STORAGE must be 'sftp' or 'local', not ${JSON.stringify(cfg.UPLOAD_STORAGE ?? '')}`,
  )
}

/** { status, error } for a storage failure during an upload, or null if err isn't one.
 *  @param {unknown} err */
export function storageFailure(err) {
  if (err instanceof StorageFullError) return { status: 507, error: 'Image storage is nearly full. Contact Nuvho support.' }
  if (err instanceof StorageUnavailableError) return { status: 502, error: 'Image storage is unavailable. Try again in a minute.' }
  return null
}
