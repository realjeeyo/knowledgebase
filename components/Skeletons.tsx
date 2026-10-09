import Image from 'next/image'

// Loading placeholders shaped like the real page parts, so content drops into place
// instead of jumping. Used by the route loading.tsx files and client-side fetches.

/** Article tile placeholder (same box as components/ArticleTile.tsx). */
export function TileSkeleton() {
  return (
    <div className="nw-tile nw-skel-tile" aria-hidden="true">
      <div className="nw-tile__slot nv-skel" />
      <div className="nw-tile__body">
        <span className="nv-skel nv-skel--tag" />
        <span className="nv-skel nv-skel--title" />
        <span className="nv-skel nv-skel--line" />
        <span className="nv-skel nv-skel--line nv-skel--short" />
      </div>
    </div>
  )
}

export function TileGridSkeleton({ count = 6, label = 'Loading articles' }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <div className="nw-tiles">
        {Array.from({ length: count }, (_, i) => <TileSkeleton key={i} />)}
      </div>
    </div>
  )
}

/** Header shell: the logo stays put while the per-request header (session, topics) loads. */
export function HeaderSkeleton() {
  return (
    <header className="nw-header">
      <div className="nw-wrap nw-header__inner">
        <span className="nw-header__logo">
          <Image src="/logo-primary.svg" alt="Nuvho" width={102} height={36} priority />
        </span>
      </div>
    </header>
  )
}

/** Hero on the Blue Slate ground with placeholder title bars. */
export function HeroSkeleton({ home = false }: { home?: boolean }) {
  return (
    <section className={`nw-hero${home ? '' : ' nw-hero--inner'}`} aria-hidden="true">
      <div className="nw-hero__bg">
        <span className="nv-sheet nv-sheet--1" />
        <span className="nv-sheet nv-sheet--2" />
        <span className="nv-sheet nv-sheet--focal" />
      </div>
      <div className="nw-wrap nw-hero__inner">
        <span className="nv-skel nv-skel--ondark nv-skel--crumb" />
        <span className="nv-skel nv-skel--ondark nv-skel--h1" />
        <span className="nv-skel nv-skel--ondark nv-skel--copy" />
      </div>
    </section>
  )
}

/** App pages (admin, editor): header shell and a centred spinner. */
export function AppPageSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col min-h-screen">
      <HeaderSkeleton />
      <main className="flex-1 na-page">
        <div className="na-loading" role="status" aria-live="polite">
          <span className="nv-spin" aria-hidden="true" />
          <span className="sr-only">{label}…</span>
        </div>
      </main>
    </div>
  )
}

/** Full page placeholder: header, hero, then a band of tiles (or an article body). */
export function PageSkeleton({ variant = 'tiles', label }: { variant?: 'tiles' | 'article' | 'home'; label: string }) {
  return (
    <div className="flex flex-col min-h-screen">
      <HeaderSkeleton />
      <main className="flex-1">
        <HeroSkeleton home={variant === 'home'} />
        <section className={`nw-section nw-section--tight${variant === 'article' ? ' nw-section--band' : ''}`}>
          <div className="nw-wrap">
            {variant === 'article' ? (
              <div className="nw-reader" role="status" aria-live="polite">
                <span className="sr-only">{label}…</span>
                {[100, 96, 88, 100, 72, 0, 100, 92, 64].map((w, i) =>
                  w === 0
                    ? <br key={i} />
                    : <span key={i} className="nv-skel nv-skel--line nv-skel--para" style={{ width: `${w}%` }} />
                )}
              </div>
            ) : (
              <TileGridSkeleton label={label} />
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
