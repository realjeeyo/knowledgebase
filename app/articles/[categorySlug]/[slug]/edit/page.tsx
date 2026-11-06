import { redirect, notFound } from 'next/navigation'
import SiteHeader from '@/components/SiteHeader'
import Footer from '@/components/Footer'
import InnerHero from '@/components/InnerHero'
import Icon from '@/components/Icon'
import { getSession } from '@/lib/auth'
import { getCategoryBySlug, getArticleBySlug } from '@/lib/data'
import { isVersioningEnabled } from '@/lib/flags'
import { hasLibraryImages } from '@/lib/imageLibraryDb'
import VersionHistory from '@/components/admin/VersionHistory'
import ArticleEditForm from './ArticleEditForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: { categorySlug: string; slug: string }
}

export async function generateMetadata({ params }: Props) {
  const article = await getArticleBySlug(params.categorySlug, params.slug)
  if (!article) return {}
  return { title: `Edit: ${article.title} — Nuvho KB` }
}

export default async function ArticleEditPage({ params }: Props) {
  // Auth guard — @nuvho.com only
  const session = await getSession()
  if (!session || !session.email.endsWith('@nuvho.com')) {
    redirect('/login')
  }

  // "Choose from library" shows only once the image library has photos (no env flag)
  const [article, category, imageLibrary] = await Promise.all([
    getArticleBySlug(params.categorySlug, params.slug),
    getCategoryBySlug(params.categorySlug),
    hasLibraryImages(),
  ])
  if (!article || !category) notFound()

  // Version history (Pass 4) renders only when KB_VERSIONING_ENABLED is on
  const versioning = isVersioningEnabled()

  return (
    <div className="flex flex-col min-h-screen">
      <SiteHeader />
      <main className="flex-1">
        <InnerHero
          title="Edit article"
          lede={article.title}
          crumbs={[
            { label: 'Knowledge Base', href: '/' },
            { label: category.title, href: `/categories/${category.slug}` },
            { label: article.title, href: `/articles/${category.slug}/${article.slug}` },
            { label: 'Edit' },
          ]}
          tags={<span className="nw-tag nw-tag--lg nw-tag--dark"><Icon name={category.icon} size={12} />{category.title}</span>}
          meta={<span>Editing as {session.email}</span>}
        />

        {/* Same band + centred reader card as the article page, so the editor sits where the article renders */}
        <section className="nw-section nw-section--band nw-section--tight">
          <div className="nw-wrap">
            <div className="nw-reader">
              <ArticleEditForm
                categorySlug={params.categorySlug}
                slug={params.slug}
                initialTitle={article.title}
                initialDescription={article.description}
                initialContent={article.content ?? ''}
                initialReadTime={article.readTime}
                versioning={versioning}
                imageLibrary={imageLibrary}
                effectiveVisibility={article.effectiveVisibility}
                updatedAt={article.updatedAt}
              />
            </div>
            {versioning && (
              <div className="nw-reader na-history-card">
                <VersionHistory categorySlug={params.categorySlug} slug={params.slug} />
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
