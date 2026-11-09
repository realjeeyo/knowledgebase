/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    domains: [],
  },
  experimental: {
    // instrumentation.ts: refuse to start with missing or invalid image-storage settings
    instrumentationHook: true,
    // ssh2 (image file store, lib/fileStore.mjs) loads optional native add-ons; keep it
    // out of the webpack bundle and load it from node_modules at runtime.
    serverComponentsExternalPackages: ['ssh2'],
  },
}

module.exports = nextConfig
