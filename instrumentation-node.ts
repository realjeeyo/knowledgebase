import { getFileStore } from './lib/fileStoreInstance'

// Start-up check for image storage (same rule as Nuvho Onboarding): a missing or invalid
// UPLOAD_STORAGE / SFTP_* setting stops this version from starting, so App Platform's
// health check fails and the previous deployment keeps serving. Only the settings are
// checked here, not the connection: if the file server is briefly unreachable the site
// still starts, and image requests answer 502 until it is back.
try {
  const store = getFileStore()
  console.log(`[startup] image storage: ${store.driver}`)
} catch (err) {
  console.error(`[startup] ${(err as Error).message}`)
  process.exit(1)
}
