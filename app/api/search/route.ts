import { NextRequest, NextResponse } from 'next/server'
import { canView } from '@/lib/data'
import { searchArticles } from '@/lib/search'
import { getSession } from '@/lib/auth'
import type { SearchSuggestion } from '@/lib/types'

export const dynamic = 'force-dynamic'

const SUGGESTION_LIMIT = 6

// GET ?q=…            full results for /search (articles, incl. content for tile hero images)
// GET ?q=…&suggest=1  a few lightweight matches for the search-as-you-type dropdown
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 200)
  const suggest = request.nextUrl.searchParams.get('suggest') === '1'

  try {
    const [docs, session] = await Promise.all([searchArticles(q), getSession()])
    const hasSession = !!session
    const visible = docs.filter(d => canView(d.article.effectiveVisibility, hasSession))

    if (suggest) {
      const suggestions: SearchSuggestion[] = visible.slice(0, SUGGESTION_LIMIT).map(d => ({
        title: d.article.title,
        description: d.article.description,
        categorySlug: d.article.categorySlug,
        slug: d.article.slug,
        categoryTitle: d.categoryTitle,
        isPrivate: d.article.effectiveVisibility === 'private',
      }))
      return NextResponse.json({ suggestions })
    }

    return NextResponse.json({ articles: visible.map(d => d.article) })
  } catch (err) {
    console.error('[/api/search] Error:', err)
    return NextResponse.json({ articles: [], suggestions: [], error: 'Search failed' }, { status: 500 })
  }
}
