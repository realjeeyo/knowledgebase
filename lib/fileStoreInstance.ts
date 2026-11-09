import { createFileStore, type FileStore } from './fileStore.mjs'

// One file store per server process, built from the environment on first use (and checked
// at start-up by instrumentation.ts). Kept on globalThis so `next dev` hot reloads reuse the
// same SFTP connection instead of opening a new one per reload.

const g = globalThis as typeof globalThis & { __kbFileStore?: FileStore }

export function getFileStore(): FileStore {
  if (!g.__kbFileStore) g.__kbFileStore = createFileStore(process.env)
  return g.__kbFileStore
}
