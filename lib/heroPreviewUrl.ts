// URL of the staff-only hero preview page (app/admin/hero-preview/page.tsx) that the image
// library picker shows in an iframe. Everything comes from the unsaved form, so it works for
// an article that has not been created yet.
export interface HeroPreviewParams {
  src: string
  alt?: string
  title: string
  description: string
  categorySlug: string
  readTime?: string | number
  visibility?: 'public' | 'private'
  /** Last-updated date as shown on the article; omit for "today". */
  updated?: string
}

export function heroPreviewUrl(p: HeroPreviewParams): string {
  const q = new URLSearchParams({ src: p.src, alt: p.alt ?? '', title: p.title, desc: p.description, cat: p.categorySlug })
  if (p.readTime !== undefined && String(p.readTime) !== '') q.set('read', String(p.readTime))
  if (p.visibility) q.set('vis', p.visibility)
  if (p.updated) q.set('updated', p.updated)
  return `/admin/hero-preview?${q}`
}
