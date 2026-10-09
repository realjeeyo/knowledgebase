import Link from 'next/link'
import Icon from './Icon'
import { Category } from '@/lib/types'

// Topics as the Figma service cards (Home 05: r24, icon 44, Comfortaa 28, Steel Blue hover).
export default function TopicGrid({ categories }: { categories: Category[] }) {
  if (categories.length === 0) {
    return <p className="nw-count">No topics have been published yet.</p>
  }

  return (
    <div className="nw-services">
      {categories.map(c => (
        <Link key={c.slug} href={`/categories/${c.slug}`} className="nw-service">
          <span className="nw-service__link" aria-hidden="true" />
          <span className="nw-service__grain" aria-hidden="true" />
          <span className="nw-service__glow" aria-hidden="true" />
          <span className="nw-service__s1" aria-hidden="true" />
          <span className="nw-service__s2" aria-hidden="true" />
          <Icon name={c.icon} size={44} className="nw-service__icon" />
          <h3>
            {c.title}
            {c.visibility === 'private' && <Icon name="lock" size={16} alt="Sign-in required" />}
          </h3>
          <p>{c.description}</p>
          <span className="nw-service__meta">
            {c.articleCount} {c.articleCount === 1 ? 'article' : 'articles'}
          </span>
        </Link>
      ))}
    </div>
  )
}
