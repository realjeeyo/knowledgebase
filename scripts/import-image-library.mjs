#!/usr/bin/env node
// Image library snapshot import — decision 2026-11-05 (snapshot, not a live Graph link).
//
// Reads a local copy of the Marketing SharePoint "Image Repository" folder
// (nuvhosystems › Documents › Nuvho Pty Ltd › Marketing › 6. Content › Image Repository),
// resizes every photo, saves the files in the KB image store (lib/fileStore.mjs) and records
// them in the KB database so editors can pick them as an article hero.
//
// Get the local copy with SharePoint's "Download" on the Image Repository folder (unzip it)
// or by syncing the folder with OneDrive, then point this script at the Image Repository
// folder itself — its subfolders become the picker's collections.
//
// Usage:
//   node scripts/import-image-library.mjs "<path to Image Repository>" --dry-run
//   node scripts/import-image-library.mjs "<path to Image Repository>" --yes
//
// Options:
//   --dry-run        List what would change; writes nothing (needs the DB only to compare).
//   --yes            Required to write. The target database host is printed first.
//   --width <px>     Stored width, default 2400 (never enlarges).
//   --quality <q>    JPEG quality, default 85.
//   --keep-missing   Do not deactivate photos that are no longer in the folder.
//
// Needs DATABASE_URL and the image-store settings (UPLOAD_STORAGE=sftp plus SFTP_*), read from
// .env.local then .env, and migrations 005, 008 and 009 applied. The SFTP port on nuvho-vectordb
// listens on the private network only, so from a laptop open a tunnel first and point
// SFTP_HOST/SFTP_PORT at it (docs/handover/2026-11-kb-image-files.md):
//   ssh -N -L 12222:10.126.0.14:2222 root@209.38.90.132   → SFTP_HOST=127.0.0.1, SFTP_PORT=12222
// Re-runs are safe: unchanged files (same SHA-1) are skipped.

import { promises as fs } from 'fs'
import path from 'path'
import { createHash, randomBytes } from 'crypto'
import dotenv from 'dotenv'
import pg from 'pg'
import sharp from 'sharp'
import { toSourcePath, collectionOf, isImageFile, titleOf, creditOf } from './lib/library-names.mjs'
import { createFileStore } from '../lib/fileStore.mjs'

dotenv.config({ path: '.env.local' })
dotenv.config()

const THUMB_WIDTH = 480
const IMPORTED_BY = 'image-library-import'

// ─── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { dir: '', dryRun: false, yes: false, width: 2400, quality: 85, keepMissing: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--yes') opts.yes = true
    else if (a === '--keep-missing') opts.keepMissing = true
    else if (a === '--width') opts.width = Number(argv[++i])
    else if (a === '--quality') opts.quality = Number(argv[++i])
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else opts.dir = a
  }
  if (!opts.dir) throw new Error('Pass the path to the Image Repository folder.')
  if (!Number.isInteger(opts.width) || opts.width < 800 || opts.width > 6000) throw new Error('--width must be 800–6000.')
  if (!Number.isInteger(opts.quality) || opts.quality < 40 || opts.quality > 100) throw new Error('--quality must be 40–100.')
  return opts
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Same id format as lib/uploads.ts newId(): <base36 ms>-<12 hex>. */
function newUploadId() {
  return `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`
}

const sha1 = buf => createHash('sha1').update(buf).digest('hex')

async function walk(root, rel = '') {
  const out = []
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true })
  for (const e of entries) {
    const childRel = rel ? path.join(rel, e.name) : e.name
    if (e.isDirectory()) out.push(...await walk(root, childRel))
    else if (e.isFile() && isImageFile(e.name)) out.push(childRel)
  }
  return out
}

function describeTarget(url) {
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || 5432}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

async function render(buf, width, quality) {
  // rotate() applies EXIF orientation; metadata (incl. GPS) is stripped by default.
  const full = await sharp(buf).rotate()
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  const thumb = await sharp(buf).rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer()
  return { full: full.data, width: full.info.width, height: full.info.height, thumb }
}

/** Saves one JPEG in the file store; its metadata row is added later, in the transaction. */
async function storeFile(store, buf) {
  const id = newUploadId()
  const key = `${id}.jpg`
  await store.put(key, buf)
  return { id, key, size: buf.length, url: `/uploads/${key}` }
}

async function insertUpload(client, file) {
  await client.query(
    `INSERT INTO nuvho_kb.uploads (id, ext, mime, size_bytes, uploaded_by)
     VALUES ($1, 'jpg', 'image/jpeg', $2, $3)`,
    [file.id, file.size, IMPORTED_BY],
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const root = path.resolve(opts.dir)
  const stat = await fs.stat(root).catch(() => null)
  if (!stat?.isDirectory()) throw new Error(`Not a folder: ${root}`)
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (.env.local or .env).')

  const target = describeTarget(process.env.DATABASE_URL)
  // No default here: rows written to a shared database must point at files the site serves,
  // so the operator says which store the files go to (sftp for production).
  if (!process.env.UPLOAD_STORAGE) {
    throw new Error('Set UPLOAD_STORAGE: sftp (with the SFTP_* settings) for production, local only for a local test database.')
  }
  const store = createFileStore(process.env)
  const filesTarget = store.driver === 'sftp'
    ? `sftp://${process.env.SFTP_USER}@${process.env.SFTP_HOST}:${process.env.SFTP_PORT || 2222}${process.env.SFTP_ROOT}`
    : `local folder ${path.resolve(process.env.UPLOADS_DIR || 'uploads')}`
  console.log(`Source : ${root}`)
  console.log(`Target : ${target}${opts.dryRun ? '  (dry run — nothing will be written)' : ''}`)
  console.log(`Files  : ${filesTarget}`)
  if (!opts.dryRun && !opts.yes) {
    console.log('\nRe-run with --yes to write to this database and file store, or --dry-run to preview.')
    process.exitCode = 1
    store.close()
    return
  }

  const files = (await walk(root)).sort()
  console.log(`Found  : ${files.length} image files\n`)

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  const existing = new Map(
    (await pool.query('SELECT id, source_path, source_sha1, active FROM nuvho_kb.image_library')).rows
      .map(r => [r.source_path, r]),
  )

  const seen = new Set()
  const counts = { added: 0, updated: 0, unchanged: 0, reactivated: 0, failed: 0, deactivated: 0 }
  let bytesStored = 0
  let storageStopped = false

  for (const rel of files) {
    const sourcePath = toSourcePath(rel)
    seen.add(sourcePath)
    const prev = existing.get(sourcePath)
    let buf
    try {
      buf = await fs.readFile(path.join(root, rel))
    } catch (err) {
      counts.failed++
      console.error(`  ✗ ${sourcePath}: ${err.message}`)
      continue
    }
    const hash = sha1(buf)

    if (prev && prev.source_sha1 === hash) {
      if (prev.active) { counts.unchanged++; continue }
      counts.reactivated++
      console.log(`  ↺ ${sourcePath}`)
      if (!opts.dryRun) {
        await pool.query('UPDATE nuvho_kb.image_library SET active = TRUE, updated_at = NOW() WHERE id = $1', [prev.id])
      }
      continue
    }

    const verb = prev ? 'updated' : 'added'
    if (opts.dryRun) {
      counts[verb]++
      console.log(`  ${prev ? '~' : '+'} ${sourcePath}`)
      continue
    }

    let img
    try {
      img = await render(buf, opts.width, opts.quality)
    } catch (err) {
      counts.failed++
      console.error(`  ✗ ${sourcePath}: could not read image (${err.message})`)
      continue
    }

    // Files first, then their rows in one transaction; if the rows fail, the files go again.
    let full, thumb
    try {
      full = await storeFile(store, img.full)
      thumb = await storeFile(store, img.thumb)
    } catch (err) {
      if (full) await store.remove(full.key).catch(() => {})
      counts.failed++
      console.error(`  ✗ ${sourcePath}: could not save the file (${err.message})`)
      // Storage down or full: every later photo would fail the same way
      if (err.name === 'StorageFullError' || err.name === 'StorageUnavailableError') { storageStopped = true; break }
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await insertUpload(client, full)
      await insertUpload(client, thumb)
      const title = titleOf(sourcePath)
      await client.query(
        `INSERT INTO nuvho_kb.image_library
           (id, source_path, source_sha1, collection, title, credit, width, height,
            upload_id, url, thumb_upload_id, thumb_url, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
         ON CONFLICT (source_path) DO UPDATE SET
           source_sha1 = EXCLUDED.source_sha1, collection = EXCLUDED.collection,
           title = EXCLUDED.title, credit = EXCLUDED.credit,
           width = EXCLUDED.width, height = EXCLUDED.height,
           upload_id = EXCLUDED.upload_id, url = EXCLUDED.url,
           thumb_upload_id = EXCLUDED.thumb_upload_id, thumb_url = EXCLUDED.thumb_url,
           active = TRUE, updated_at = NOW()`,
        [sha1(sourcePath), sourcePath, hash, collectionOf(sourcePath), title, creditOf(title),
         img.width, img.height, full.id, full.url, thumb.id, thumb.url],
      )
      await client.query('COMMIT')
      counts[verb]++
      bytesStored += img.full.length + img.thumb.length
      console.log(`  ${prev ? '~' : '+'} ${sourcePath}  (${img.width}×${img.height}, ${Math.round(img.full.length / 1024)} KB)`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      await store.remove(full.key).catch(() => {})
      await store.remove(thumb.key).catch(() => {})
      counts.failed++
      console.error(`  ✗ ${sourcePath}: ${err.message}`)
    } finally {
      client.release()
    }
  }

  // Photos removed from the folder: hide from the picker, keep their URLs working.
  // Skipped after a storage stop: the files after it were never looked at
  if (!opts.keepMissing && !storageStopped) {
    const gone = [...existing.values()].filter(r => r.active && !seen.has(r.source_path))
    for (const r of gone) console.log(`  − ${r.source_path}`)
    counts.deactivated = gone.length
    if (gone.length && !opts.dryRun) {
      await pool.query(
        'UPDATE nuvho_kb.image_library SET active = FALSE, updated_at = NOW() WHERE id = ANY($1)',
        [gone.map(r => r.id)],
      )
    }
  }

  await pool.end()
  store.close()
  console.log(
    `\n${opts.dryRun ? 'Would have: ' : ''}${counts.added} added, ${counts.updated} updated, ` +
    `${counts.reactivated} reactivated, ${counts.deactivated} deactivated, ` +
    `${counts.unchanged} unchanged, ${counts.failed} failed` +
    (opts.dryRun ? '' : ` — ${(bytesStored / 1048576).toFixed(1)} MB stored`),
  )
  if (storageStopped) console.error('Stopped early: the image store is unavailable or full. Nothing was deactivated; re-run once it is fixed.')
  if (counts.failed) process.exitCode = 1
}

main().catch(err => {
  console.error(`\nImport failed: ${err.message}`)
  process.exitCode = 1
})
