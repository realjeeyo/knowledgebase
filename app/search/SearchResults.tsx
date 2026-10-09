'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ArticleTile, { TileCategory } from '@/components/ArticleTile'
import EmptyState from '@/components/EmptyState'
import { TileGridSkeleton } from '@/components/Skeletons'
import { Article } from '@/lib/types'

interface Props {
  query: string
  categories: Record<string, TileCategory>
}

export default function SearchResults({ query, categories }: Props) {
  const [results, setResults] = useState<Article[]>([])
  // Starts loading when there is a query, so "No results" never flashes before the fetch
  const [loading, setLoading] = useState(!!query)

  useEffect(() => {
    if (!query) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setResults(data.articles ?? []) })
      .catch(() => { if (!cancelled) setResults([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query])

  if (!query) {
    return (
      <EmptyState
        icon="lightbulb"
        title="Start with a keyword"
        body="Try a product name, a task you are doing, or the exact wording of an error message."
      />
    )
  }

  if (loading) {
    return <TileGridSkeleton label="Searching" />
  }

  if (results.length === 0) {
    return (
      <EmptyState
        icon="magnifying-glass"
        title="No results found"
        body={`Nothing matched “${query}”. Try different keywords, or browse the topics instead.`}
        action={<Link href="/#topics" className="nv-btn nv-btn--secondary nv-btn--lg">Browse all topics</Link>}
      />
    )
  }

  return (
    <>
      <p className="nw-count">
        Showing {results.length} {results.length === 1 ? 'article' : 'articles'}&nbsp;&nbsp;·&nbsp;&nbsp;“{query}”
      </p>
      <div className="nw-tiles">
        {results.map(a => (
          <ArticleTile key={`${a.categorySlug}/${a.slug}`} article={a} category={categories[a.categorySlug]} />
        ))}
      </div>
    </>
  )
}
