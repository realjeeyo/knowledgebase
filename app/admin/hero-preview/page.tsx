import { notFound, redirect } from 'next/navigation'
import SiteHeader from '@/components/SiteHeader'
import InnerHero from '@/components/InnerHero'
import ArticleTile from '@/components/ArticleTile'
import Icon from '@/components/Icon'
import { injectHero } from '@/components/heroImage'
import { getSession } from '@/lib/auth'
import { getCategoryBySlug } from '@/lib/data'
import type { Article } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Hero preview — Nuvho KB', robots: { index: false, follow: false } }

interface Props {
  searchParams: {
    src?: string; alt?: string; title?: string; desc?: string
    /** Category slug (required), read time in minutes, effective visibility, last-updated date. */
    cat?: string; read?: string; vis?: string; updated?: string
  }
}

/** Only site-relative paths (/uploads/…) and http(s) URLs are rendered. */
function safeSrc(src: string | undefined): string {
  const s = (src ?? '').trim()
  if (s.startsWith('/') && !s.startsWith('//')) return s
  return /^https?:\/\//i.test(s) ? s : ''
}

const clip = (s: string | undefined, max: number) => (s ?? '').slice(0, max)

/** Same format as the article page ("Nov 06, 2026"); today for an article not saved yet. */
function formatUpdated(value: string | undefined): string {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) return clip(value, 40)
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

// Hero preview for the image library picker (components/ImageLibraryPicker.tsx), loaded in
// an iframe at desktop or phone width so the real breakpoints apply. Used by the article Edit
// page and the admin dashboard's article form (new and existing articles), so everything it
// shows comes from the unsaved form via the query string; only the category is looked up.
// Renders the article hero exactly as the article page does, then the article tile.
// Nothing is saved. Staff only.
export default async function HeroPreviewPage({ searchParams }: Props) {
  const session = await getSession()
  if (!session || !session.email.endsWith('@nuvho.com')) redirect('/login')

  const category = searchParams.cat ? await getCategoryBySlug(searchParams.cat) : null
  if (!category) notFound()

  const src = safeSrc(searchParams.src)
  const alt = clip(searchParams.alt, 300)
  const title = clip(searchParams.title, 300).trim() || 'Untitled article'
  const description = clip(searchParams.desc, 1000).trim()
  const readTime = Math.min(Math.max(Number.parseInt(searchParams.read ?? '', 10) || 5, 1), 600)
  const visibility = searchParams.vis === 'private' ? 'private' : 'public'
  const updated = formatUpdated(searchParams.updated)
  const hero = src ? { src, alt } : null

  const tileArticle: Article = {
    slug: 'preview',
    title,
    description,
    content: injectHero('', src, alt),
    categorySlug: category.slug,
    subcategorySlug: '',
    updatedAt: updated,
    readTime,
    status: 'published',
    visibility,
    effectiveVisibility: visibility,
  }

  return (
    <div className="flex flex-col min-h-screen nw-preview-frame">
      <SiteHeader />
      <main className="flex-1">
        <InnerHero
          title={title}
          image={hero}
          crumbs={[
            { label: 'Knowledge Base', href: '/' },
            { label: category.title, href: `/categories/${category.slug}` },
            { label: title },
          ]}
          tags={
            <>
              <span className="nw-tag nw-tag--lg nw-tag--dark"><Icon name={category.icon} size={12} />{category.title}</span>
              {visibility === 'private' && (
                <span className="nw-tag nw-tag--lg nw-tag--dark"><Icon name="lock" size={11} />Members only</span>
              )}
            </>
          }
          meta={
            <>
              <span><Icon name="clock" size={13} onDark /> {readTime} min read</span>
              <span>Updated {updated}</span>
            </>
          }
        />

        <section className="nw-section nw-section--band nw-section--tight">
          <div className="nw-wrap">
            {description && (
              <div className="nw-reader">
                <p className="nw-article__lede">{description}</p>
              </div>
            )}
            <p className="nw-preview-label">On article tiles</p>
            <div className="nw-tiles">
              <ArticleTile article={tileArticle} category={{ title: category.title, icon: category.icon }} />
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
