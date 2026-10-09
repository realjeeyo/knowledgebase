import type { ReactNode } from 'react'
import Breadcrumb, { Crumb } from './Breadcrumb'
import type { HeroImage } from './heroImage'

interface Props {
  title: string
  lede?: string
  crumbs?: Crumb[]
  tags?: ReactNode
  meta?: ReactNode
  children?: ReactNode
  /** Home variant: 520 tall, 52px H1 (Figma 793:24). Inner pages use the 360 proposal. */
  home?: boolean
  /** Photo hero: media → Tropical Teal veil → photo @40% → art overlay → copy scrim (Figma 793:24 layer order). */
  image?: HeroImage | null
}

// Hero on the Blue Slate GROUND gradient with sheets built to the radius law, or the
// Figma photo stack when an image is supplied.
export default function InnerHero({ title, lede, crumbs, tags, meta, children, home = false, image = null }: Props) {
  const classes = ['nw-hero', home ? '' : 'nw-hero--inner', image ? 'nw-hero--photo' : ''].filter(Boolean).join(' ')

  return (
    <section className={classes}>
      {/* Decorative layers clip inside their own box, so the hero itself doesn't clip —
          the search suggestions list can then hang below the hero's bottom edge. */}
      <div className="nw-hero__bg" aria-hidden="true">
        {image ? (
          <>
            <div className="nw-hero__veil" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="nw-hero__photo" src={image.src} srcSet={image.srcSet} sizes="100vw" alt={image.alt} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="nw-hero__art" src="/hero/art-overlay.svg" alt="" aria-hidden="true" />
          </>
        ) : (
          <>
            <span className="nv-sheet nv-sheet--1" aria-hidden="true" />
            <span className="nv-sheet nv-sheet--2" aria-hidden="true" />
            <span className="nv-sheet nv-sheet--focal" aria-hidden="true" />
          </>
        )}
        <div className="nw-hero__scrim" aria-hidden="true" />
      </div>
      <div className="nw-wrap nw-hero__inner">
        {crumbs && <div className="nw-hero__crumb"><Breadcrumb items={crumbs} /></div>}
        {tags && <div className="nw-hero__tags">{tags}</div>}
        <h1 className="nw-hero__h1">{title}</h1>
        {lede && <p className="nw-hero__copy">{lede}</p>}
        {meta && <div className="nw-hero__meta">{meta}</div>}
        {children}
      </div>
    </section>
  )
}
