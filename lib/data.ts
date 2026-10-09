import pool from './db'
import { Article, Category, SearchDocument, Subcategory, Visibility } from './types'

// ─── DB row types ────────────────────────────────────────────────────────────

interface CategoryRow {
  slug: string
  title: string
  description: string
  icon: string
  article_count: number
  visibility: Visibility
}

interface SubcategoryRow {
  slug: string
  title: string
  description: string
  category_slug: string
  sort_order: number
  article_count: number
  visibility: Visibility | null
}

interface ArticleRow {
  slug: string
  title: string
  description: string
  content: string | null
  category_slug: string
  subcategory_slug: string
  updated_at: string
  read_time: number
  featured: boolean
  status: 'pending' | 'published'
  visibility: Visibility | null
  category_visibility: Visibility
  subcategory_visibility: Visibility | null
  category_title: string
  subcategory_title: string
}

// Article select fragment shared by every article query below — joins in the
// category/sub-category visibility needed to resolve effective visibility.
const ARTICLE_SELECT = `
  SELECT a.slug, a.title, a.description, a.content, a.category_slug, a.subcategory_slug,
         to_char(a.updated_at, 'Mon DD, YYYY') AS updated_at,
         a.read_time, a.featured, a.status, a.visibility,
         c.visibility AS category_visibility,
         s.visibility AS subcategory_visibility,
         c.title AS category_title, s.title AS subcategory_title
  FROM nuvho_kb.articles a
  JOIN nuvho_kb.categories c ON c.slug = a.category_slug
  JOIN nuvho_kb.subcategories s ON s.slug = a.subcategory_slug
`

// ─── Visibility resolution ───────────────────────────────────────────────────

/** Most specific explicit setting wins: article → sub-category → category. */
export function resolveVisibility(
  articleVisibility: Visibility | null,
  subcategoryVisibility: Visibility | null,
  categoryVisibility: Visibility
): Visibility {
  return articleVisibility ?? subcategoryVisibility ?? categoryVisibility ?? 'public'
}

/** Whether a viewer (logged in or not) may see something with this effective visibility. */
export function canView(effectiveVisibility: Visibility, hasSession: boolean): boolean {
  return effectiveVisibility === 'public' || hasSession
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapArticle(row: ArticleRow): Article {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    content: row.content ?? undefined,
    categorySlug: row.category_slug,
    subcategorySlug: row.subcategory_slug,
    updatedAt: row.updated_at,
    readTime: row.read_time,
    featured: row.featured,
    status: row.status,
    visibility: row.visibility,
    effectiveVisibility: resolveVisibility(row.visibility, row.subcategory_visibility, row.category_visibility),
  }
}

function mapSubcategory(row: SubcategoryRow, articles: Article[]): Subcategory {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    categorySlug: row.category_slug,
    sortOrder: row.sort_order,
    articleCount: row.article_count,
    visibility: row.visibility,
    articles,
  }
}

function mapCategory(row: CategoryRow, articles: Article[], subcategories: Subcategory[]): Category {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    icon: row.icon,
    articleCount: row.article_count,
    articles,
    subcategories,
    visibility: row.visibility,
  }
}

// ─── Public API (published-only) ──────────────────────────────────────────────
//
// Visibility is NOT filtered out here — every function below returns the full
// set annotated with `visibility` / `effectiveVisibility`. Callers (page
// components, the search API route) know whether the current visitor has a
// session and decide what to hide or gate using `canView()` above. This keeps
// the access-control decision next to the request/session, not buried in the
// data layer.

/** All categories with their PUBLISHED articles, grouped into sub-categories. */
export async function getCategories(): Promise<Category[]> {
  const catResult = await pool.query<CategoryRow>(
    `SELECT slug, title, description, icon, article_count, visibility
     FROM nuvho_kb.categories
     ORDER BY sort_order, title`
  )
  if (catResult.rows.length === 0) return []

  const slugs = catResult.rows.map(r => r.slug)

  const subResult = await pool.query<SubcategoryRow>(
    `SELECT slug, title, description, category_slug, sort_order, article_count, visibility
     FROM nuvho_kb.subcategories
     WHERE category_slug = ANY($1::text[])
     ORDER BY sort_order, title`,
    [slugs]
  )

  const artResult = await pool.query<ArticleRow>(
    `${ARTICLE_SELECT}
     WHERE a.category_slug = ANY($1::text[]) AND a.status = 'published'
     ORDER BY a.sort_order, a.title`,
    [slugs]
  )

  const articlesBySubcategory = new Map<string, Article[]>()
  const articlesByCategory = new Map<string, Article[]>()
  slugs.forEach(s => articlesByCategory.set(s, []))
  artResult.rows.forEach(row => {
    const article = mapArticle(row)
    articlesByCategory.get(row.category_slug)!.push(article)
    if (!articlesBySubcategory.has(row.subcategory_slug)) articlesBySubcategory.set(row.subcategory_slug, [])
    articlesBySubcategory.get(row.subcategory_slug)!.push(article)
  })

  const subsByCategory = new Map<string, Subcategory[]>()
  slugs.forEach(s => subsByCategory.set(s, []))
  subResult.rows.forEach(row => {
    subsByCategory.get(row.category_slug)!.push(mapSubcategory(row, articlesBySubcategory.get(row.slug) ?? []))
  })

  return catResult.rows.map(row =>
    mapCategory(row, articlesByCategory.get(row.slug) ?? [], subsByCategory.get(row.slug) ?? [])
  )
}

/** Single category with its PUBLISHED articles and sub-categories. Returns null if not found. */
export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const catResult = await pool.query<CategoryRow>(
    `SELECT slug, title, description, icon, article_count, visibility
     FROM nuvho_kb.categories WHERE slug = $1`,
    [slug]
  )
  if (catResult.rows.length === 0) return null

  const subResult = await pool.query<SubcategoryRow>(
    `SELECT slug, title, description, category_slug, sort_order, article_count, visibility
     FROM nuvho_kb.subcategories
     WHERE category_slug = $1
     ORDER BY sort_order, title`,
    [slug]
  )

  const artResult = await pool.query<ArticleRow>(
    `${ARTICLE_SELECT}
     WHERE a.category_slug = $1 AND a.status = 'published'
     ORDER BY a.sort_order, a.title`,
    [slug]
  )

  const articlesBySubcategory = new Map<string, Article[]>()
  const allArticles: Article[] = []
  artResult.rows.forEach(row => {
    const article = mapArticle(row)
    allArticles.push(article)
    if (!articlesBySubcategory.has(row.subcategory_slug)) articlesBySubcategory.set(row.subcategory_slug, [])
    articlesBySubcategory.get(row.subcategory_slug)!.push(article)
  })

  const subcategories = subResult.rows.map(row =>
    mapSubcategory(row, articlesBySubcategory.get(row.slug) ?? [])
  )

  return mapCategory(catResult.rows[0], allArticles, subcategories)
}

/** Single PUBLISHED article by category + article slug. Returns null if not found or pending. */
export async function getArticleBySlug(
  categorySlug: string,
  articleSlug: string
): Promise<Article | null> {
  const result = await pool.query<ArticleRow>(
    `${ARTICLE_SELECT}
     WHERE a.category_slug = $1 AND a.slug = $2 AND a.status = 'published'`,
    [categorySlug, articleSlug]
  )
  return result.rows.length === 0 ? null : mapArticle(result.rows[0])
}

/** Featured PUBLISHED articles, up to `limit`. */
export async function getFeaturedArticles(limit = 4): Promise<Article[]> {
  const result = await pool.query<ArticleRow>(
    `${ARTICLE_SELECT}
     WHERE a.featured = true AND a.status = 'published'
     ORDER BY a.sort_order, a.title
     LIMIT $1`,
    [limit]
  )
  return result.rows.map(mapArticle)
}

/** Every PUBLISHED article with its topic names — the corpus lib/search.ts fuzzy-indexes. */
export async function getSearchCorpus(): Promise<SearchDocument[]> {
  const result = await pool.query<ArticleRow>(
    `${ARTICLE_SELECT}
     WHERE a.status = 'published'
     ORDER BY a.category_slug, a.sort_order, a.title`
  )
  return result.rows.map(row => ({
    article: mapArticle(row),
    categoryTitle: row.category_title,
    subcategoryTitle: row.subcategory_title,
  }))
}

/** Category slugs for generateStaticParams. */
export async function getAllCategorySlugs(): Promise<string[]> {
  const result = await pool.query<{ slug: string }>(
    'SELECT slug FROM nuvho_kb.categories ORDER BY sort_order, title'
  )
  return result.rows.map(r => r.slug)
}

/** PUBLISHED article slug pairs for generateStaticParams. */
export async function getAllArticleSlugs(): Promise<{ categorySlug: string; slug: string }[]> {
  const result = await pool.query<{ category_slug: string; slug: string }>(
    `SELECT category_slug, slug FROM nuvho_kb.articles
     WHERE status = 'published'
     ORDER BY category_slug, sort_order, title`
  )
  return result.rows.map(r => ({ categorySlug: r.category_slug, slug: r.slug }))
}
