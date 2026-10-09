import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// The brand's own variable font files (nuvho-brand fonts/, identical to the Nuvho CDN
// copies), self-hosted from this deployment — no Google Fonts at build or run time
// (nuvho-brand v4 · nuvho-web-design v2 §6).
const comfortaa = localFont({
  src: './fonts/Comfortaa-VariableFont_wght.ttf',
  weight: '300 700',
  style: 'normal',
  variable: '--font-comfortaa',
  display: 'swap',
})

const raleway = localFont({
  src: [
    { path: './fonts/Raleway-VariableFont_wght.ttf', weight: '100 900', style: 'normal' },
    { path: './fonts/Raleway-Italic-VariableFont_wght.ttf', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-raleway',
  display: 'swap',
})

export const metadata: Metadata = {
  // Lets relative URLs (e.g. /uploads/… hero images) resolve in Open Graph tags
  metadataBase: new URL('https://knowledge.nuvho.com'),
  title: 'Nuvho Knowledge Base',
  description: 'Find answers to your Nuvho questions. Guides, tutorials and documentation for Smart Hoteliers.',
  // Blue Slate favicon from the 2026 brand set (nuvho-favicons.zip) — the KB is
  // client-facing, and client surfaces lead on Blue Slate (audience scheme). Browsers
  // that support SVG favicons use the vector; the PNGs cover the rest and home screens.
  icons: {
    icon: [
      { url: '/favicon/nuvho-favicon-blue-slate.svg', type: 'image/svg+xml' },
      { url: '/favicon/nuvho-favicon-blue-slate-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon/nuvho-favicon-blue-slate-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: { url: '/favicon/nuvho-favicon-blue-slate-180.png', sizes: '180x180', type: 'image/png' },
  },
  openGraph: {
    title: 'Nuvho Knowledge Base',
    description: 'Find answers to your Nuvho questions.',
    siteName: 'Nuvho Knowledge Base',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en-AU" className={`${comfortaa.variable} ${raleway.variable}`}>
      <body className="nw-page min-h-screen font-body">
        {children}
      </body>
    </html>
  )
}
