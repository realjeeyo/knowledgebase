import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs, readFileSync } from 'fs'
import os from 'os'
import path from 'path'
import {
  createFileStore,
  isSafeKey,
  normaliseFingerprint,
  storageFailure,
  StorageConfigError,
  StorageFullError,
  StorageUnavailableError,
  type FileStore,
} from './fileStore.mjs'
import { uploadKeyFromSegments } from './uploads'

async function readAll(body: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of body) chunks.push(Buffer.from(c as Buffer))
  return Buffer.concat(chunks)
}

// Shared behaviour, run against the local driver always and against a real SFTP server
// when SFTP_TEST_* settings are present (see the SFTP block below).
function storeContract(name: string, make: () => FileStore) {
  describe(`${name} driver`, () => {
    let store: FileStore
    beforeAll(() => { store = make() })
    afterAll(() => store.close())

    it('puts, heads, gets and removes a file', async () => {
      const key = `t${Date.now().toString(36)}-0123456789ab.png`
      const data = Buffer.from('\x89PNG\r\n\x1a\n-test-bytes-' + 'x'.repeat(70000))
      await store.put(key, data)
      expect(await store.head(key)).toMatchObject({ contentLength: data.length })
      const got = await store.get(key)
      expect(got?.contentType).toBe('image/png')
      expect(got?.contentLength).toBe(data.length)
      expect((await readAll(got!.body)).equals(data)).toBe(true)
      await store.remove(key)
      expect(await store.head(key)).toBeNull()
      expect(await store.get(key)).toBeNull()
    })

    it('returns null for a missing file and ignores removing one', async () => {
      expect(await store.get('nope-000000000000.jpg')).toBeNull()
      await expect(store.remove('nope-000000000000.jpg')).resolves.toBeUndefined()
    })

    it('never overwrites an existing file', async () => {
      const key = `o${Date.now().toString(36)}-0123456789ab.jpg`
      await store.put(key, Buffer.from('first'))
      await expect(store.put(key, Buffer.from('second'))).rejects.toThrow()
      expect((await readAll((await store.get(key))!.body)).toString()).toBe('first')
      await store.remove(key)
    })

    it('rejects unsafe keys', async () => {
      for (const bad of ['../x.jpg', '/etc/passwd', 'a/../../b.jpg', 'a\\b.jpg', '', 'a//b.jpg']) {
        await expect(store.put(bad, Buffer.from('x'))).rejects.toThrow(/Invalid file key/)
      }
    })
  })
}

describe('keys and settings', () => {
  it('isSafeKey', () => {
    expect(isSafeKey('abc-0123456789ab.jpg')).toBe(true)
    expect(isSafeKey('2026/09/abc-0123456789ab.jpg')).toBe(true)
    for (const bad of ['', '/a', '../a', 'a/./b', 'a\\b', 'a\0b', 'a//b']) expect(isSafeKey(bad)).toBe(false)
  })

  it('uploadKeyFromSegments accepts only upload names', () => {
    expect(uploadKeyFromSegments(['mw4ninev-ea1b85c9a021.jpg'])).toBe('mw4ninev-ea1b85c9a021.jpg')
    expect(uploadKeyFromSegments(['2026', '09', 'mw4ninev-ea1b85c9a021.png'])).toBe('2026/09/mw4ninev-ea1b85c9a021.png')
    for (const bad of [['..', 'x.jpg'], ['mw4ninev-ea1b85c9a021.svg'], ['a.jpg'], ['x', 'mw4ninev-ea1b85c9a021.jpg'], ['MW4NINEV-EA1B85C9A021.JPG']]) {
      expect(uploadKeyFromSegments(bad)).toBeNull()
    }
  })

  it('normaliseFingerprint accepts the bare value, SHA256: prefix, or a whole ssh-keygen line', () => {
    const fp = 'YJJmmR6KtnIH/LSQCtwLOVBSQiR1XtVHDo87FSJ+HVA'
    expect(normaliseFingerprint(fp)).toBe(fp)
    expect(normaliseFingerprint(`SHA256:${fp}`)).toBe(fp)
    expect(normaliseFingerprint(`256 SHA256:${fp} root@nuvho-vectordb (ED25519)`)).toBe(fp)
    expect(normaliseFingerprint(`${fp}=`)).toBe(fp)
  })

  it('production refuses local storage, a missing driver and the removed db driver', () => {
    expect(() => createFileStore({ NODE_ENV: 'production' })).toThrow(StorageConfigError)
    expect(() => createFileStore({ NODE_ENV: 'production', UPLOAD_STORAGE: 'local' })).toThrow(/not allowed in production/)
    expect(() => createFileStore({ UPLOAD_STORAGE: 'db' })).toThrow(/removed/)
    expect(createFileStore({ NODE_ENV: 'production', UPLOAD_STORAGE: 'local', UPLOADS_LOCAL_IN_PRODUCTION: 'true' }).driver).toBe('local')
    expect(createFileStore({ NODE_ENV: 'development' }).driver).toBe('local')
  })

  it('sftp needs every setting and a usable key and fingerprint', () => {
    const base = {
      UPLOAD_STORAGE: 'sftp', SFTP_HOST: '10.126.0.14', SFTP_USER: 'kb-files', SFTP_ROOT: '/files',
      SFTP_HOST_KEY_SHA256: 'SHA256:YJJmmR6KtnIH/LSQCtwLOVBSQiR1XtVHDo87FSJ+HVA',
      SFTP_PRIVATE_KEY_B64: Buffer.from('not a key').toString('base64'),
    }
    expect(() => createFileStore({ ...base, SFTP_HOST: '' })).toThrow(/SFTP_HOST/)
    expect(() => createFileStore(base)).toThrow(/not a usable private key/)
  })

  it('maps storage errors to HTTP statuses', () => {
    expect(storageFailure(new StorageFullError())?.status).toBe(507)
    expect(storageFailure(new StorageUnavailableError('x'))?.status).toBe(502)
    expect(storageFailure(new Error('x'))).toBeNull()
  })
})

let tmp = ''
beforeAll(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-files-')) })
afterAll(async () => { if (tmp) await fs.rm(tmp, { recursive: true, force: true }) })
storeContract('local', () => createFileStore({ UPLOAD_STORAGE: 'local', UPLOADS_DIR: tmp }))

// Real SFTP server (mirrors production's sshd_config_kb_sftp). Set SFTP_TEST_HOST, _PORT,
// _KEY_FILE (private key path) and _HOST_KEY_SHA256 to run; skipped otherwise.
const sftpEnv = process.env.SFTP_TEST_HOST && process.env.SFTP_TEST_KEY_FILE
const sftpSettings = () => ({
  UPLOAD_STORAGE: 'sftp',
  SFTP_HOST: process.env.SFTP_TEST_HOST,
  SFTP_PORT: process.env.SFTP_TEST_PORT || '2222',
  SFTP_USER: process.env.SFTP_TEST_USER || 'kb-files',
  SFTP_ROOT: '/files',
  SFTP_HOST_KEY_SHA256: process.env.SFTP_TEST_HOST_KEY_SHA256,
  SFTP_PRIVATE_KEY_B64: readFileSync(process.env.SFTP_TEST_KEY_FILE!).toString('base64'),
})

describe.runIf(sftpEnv)('sftp (real server)', () => {
  storeContract('sftp', () => createFileStore(sftpSettings()))

  it('refuses a server whose host key does not match', async () => {
    const store = createFileStore({ ...sftpSettings(), SFTP_HOST_KEY_SHA256: 'SHA256:' + 'A'.repeat(43) })
    await expect(store.head('x-000000000000.jpg')).rejects.toBeInstanceOf(StorageUnavailableError)
    store.close()
  })

  it('refuses uploads when free space is below the floor', async () => {
    const store = createFileStore({ ...sftpSettings(), SFTP_MIN_FREE_BYTES: String(1e18) })
    await expect(store.put('f-000000000000.jpg', Buffer.from('x'))).rejects.toBeInstanceOf(StorageFullError)
    store.close()
  })

  it('reports an unreachable server quickly as unavailable', async () => {
    const store = createFileStore({ ...sftpSettings(), SFTP_PORT: '1' })
    const t = Date.now()
    await expect(store.get('x-000000000000.jpg')).rejects.toBeInstanceOf(StorageUnavailableError)
    expect(Date.now() - t).toBeLessThan(12000)
    store.close()
  })

  it('handles many parallel reads on one connection', async () => {
    const store = createFileStore(sftpSettings()) as FileStore & { _connections(): number }
    const key = `p${Date.now().toString(36)}-0123456789ab.jpg`
    const data = Buffer.alloc(20_000, 7)
    await store.put(key, data)
    const results = await Promise.all(Array.from({ length: 20 }, async () => readAll((await store.get(key))!.body)))
    expect(results.every(r => r.equals(data))).toBe(true)
    expect(store._connections()).toBe(1)
    await store.remove(key)
    store.close()
  })
})
