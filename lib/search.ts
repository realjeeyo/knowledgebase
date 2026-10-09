import Fuse, { type Expression, type IFuseOptions } from 'fuse.js'
import { getSearchCorpus } from './data'
import type { SearchDocument } from './types'

// Fuzzy search over PUBLISHED articles (typo-tolerant: "pasword resett" finds
// "Reset your password"). The corpus is small — one row per article — so it is
// indexed in memory with Fuse.js and rebuilt at most once a minute, rather than
// needing a Postgres extension such as pg_trgm.

interface IndexedDocument {
  title: string
  description: string
  topics: string
  text: string
  doc: SearchDocument
}

const KEYS = [
  { name: 'title', weight: 4 },
  { name: 'description', weight: 2 },
  { name: 'topics', weight: 1 },
  { name: 'text', weight: 1 },
] as const

const FUSE_OPTIONS: IFuseOptions<IndexedDocument> = {
  keys: KEYS.map(k => ({ ...k })),
  includeScore: true,
  // 0 = exact only, 1 = anything. 0.3 allows ~1 typo per 4 characters per word, and
  // stops three-letter words matching any other three-letter word.
  threshold: 0.3,
  // Article bodies are long; a match anywhere in them counts.
  ignoreLocation: true,
  minMatchCharLength: 2,
  // Lets short words opt out of fuzziness with the ' (include) operator — see anyField().
  useExtendedSearch: true,
}

// Words this short must appear as typed: one typo in "api" or "adr" is a different word.
const EXACT_MAX_CHARS = 4

const INDEX_TTL_MS = 60_000
const MAX_TEXT_CHARS = 20_000

// Words that carry no meaning in a help-centre query and would otherwise have to match.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'how', 'i', 'in', 'is', 'it',
  'my', 'of', 'on', 'or', 'the', 'to', 'what', 'when', 'where', 'why', 'with', 'you',
])

// Leading/trailing punctuation on a word ("password?" → "password"); Unicode-aware so
// accented words survive. Built with RegExp because tsconfig's default target rejects /u literals.
const EDGE_PUNCTUATION = new RegExp('^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$', 'gu')

let cache: { fuse: Fuse<IndexedDocument>; builtAt: number } | null = null
let building: Promise<Fuse<IndexedDocument>> | null = null

/** Article HTML → plain text for indexing. */
function htmlToText(html: string | undefined): string {
  if (!html) return ''
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS)
}

async function buildIndex(): Promise<Fuse<IndexedDocument>> {
  const corpus = await getSearchCorpus()
  const docs = corpus.map(doc => ({
    title: doc.article.title,
    description: doc.article.description,
    topics: `${doc.categoryTitle} ${doc.subcategoryTitle}`,
    text: htmlToText(doc.article.content),
    doc,
  }))
  return new Fuse(docs, FUSE_OPTIONS)
}

async function getIndex(): Promise<Fuse<IndexedDocument>> {
  if (cache && Date.now() - cache.builtAt < INDEX_TTL_MS) return cache.fuse
  // One rebuild at a time; concurrent searches share it.
  building ??= buildIndex()
    .then(fuse => {
      cache = { fuse, builtAt: Date.now() }
      return fuse
    })
    .finally(() => { building = null })
  try {
    return await building
  } catch (err) {
    // Keep serving the last good index if the database is briefly unavailable.
    if (cache) return cache.fuse
    throw err
  }
}

function tokenize(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(EDGE_PUNCTUATION, ''))
    .filter(w => w.length >= 2)
  const meaningful = words.filter(w => !STOP_WORDS.has(w))
  return meaningful.length > 0 ? meaningful : words
}

/** Any of the indexed fields matches this word — fuzzily, or exactly for short words. */
function anyField(word: string): Expression {
  const pattern = word.length <= EXACT_MAX_CHARS ? `'${word}` : word
  return { $or: KEYS.map(k => ({ [k.name]: pattern })) }
}

/**
 * Fuzzy-search PUBLISHED articles, best match first. Every meaningful word must
 * match some field; if nothing does, falls back to articles matching any word.
 * Visibility is not applied here — the caller filters with canView().
 */
export async function searchArticles(query: string, limit = 50): Promise<SearchDocument[]> {
  const phrase = query.trim().toLowerCase()
  const words = tokenize(phrase)
  if (words.length === 0) return []

  const fuse = await getIndex()
  let results = fuse.search({ $and: words.map(anyField) })
  if (results.length === 0 && words.length > 1) {
    results = fuse.search({ $or: words.map(anyField) })
  }

  // Fuse scores 0 (perfect) to 1. Exact phrase hits are what a reader most likely
  // meant, so they rank above near-misses: title > description > body.
  return results
    .map(r => {
      const { title, description, text } = r.item
      let score = r.score ?? 1
      if (title.toLowerCase().includes(phrase)) score -= 0.5
      else if (description.toLowerCase().includes(phrase)) score -= 0.25
      else if (text.toLowerCase().includes(phrase)) score -= 0.1
      return { doc: r.item.doc, score }
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(r => r.doc)
}
