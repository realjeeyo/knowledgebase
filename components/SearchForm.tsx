'use client'

import { FormEvent, KeyboardEvent, useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from './Icon'
import type { SearchSuggestion } from '@/lib/types'

interface Props {
  initial?: string
  autoFocus?: boolean
  popular?: string[]
}

const SUGGEST_MIN_CHARS = 2
const SUGGEST_DEBOUNCE_MS = 200

// On-dark search: input (Figma 794:104) + onDark button (794:106), used inside heroes.
// Fuzzy search-as-you-type suggestions drop down under the field (/api/search?suggest=1).
export default function SearchForm({ initial = '', autoFocus = false, popular = [] }: Props) {
  const router = useRouter()
  const listId = useId()
  const [q, setQ] = useState(initial)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [suggestedFor, setSuggestedFor] = useState('')
  const [fetching, setFetching] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [navigating, startNavigation] = useTransition()
  const skipNextFetch = useRef(true) // the initial value is already the page's query

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false
      return
    }
    const term = q.trim()
    if (term.length < SUGGEST_MIN_CHARS) {
      setSuggestions([])
      setSuggestedFor('')
      setFetching(false)
      return
    }
    const controller = new AbortController()
    setFetching(true)
    const timer = setTimeout(() => {
      fetch(`/api/search?suggest=1&q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then(r => r.json())
        .then(data => {
          setSuggestions(data.suggestions ?? [])
          setSuggestedFor(term)
          setActive(-1)
          setFetching(false)
        })
        .catch(err => {
          if ((err as Error).name !== 'AbortError') {
            setSuggestions([])
            setFetching(false)
          }
        })
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q])

  function navigate(href: string) {
    setOpen(false)
    startNavigation(() => router.push(href))
  }

  function go(term: string) {
    const t = term.trim()
    if (t) navigate(`/search?q=${encodeURIComponent(t)}`)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (open && active >= 0 && suggestions[active]) {
      const s = suggestions[active]
      navigate(`/articles/${s.categorySlug}/${s.slug}`)
    } else {
      go(q)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActive(i => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActive(i => (i <= 0 ? suggestions.length - 1 : i - 1))
    }
  }

  const term = q.trim()
  const showList = open && term.length >= SUGGEST_MIN_CHARS && (suggestions.length > 0 || (!fetching && suggestedFor === term))

  return (
    <>
      <form className="nw-search" role="search" onSubmit={onSubmit}>
        <div className="nw-search__field">
          <Icon name="magnifying-glass" size={18} />
          <input
            type="search"
            className="nw-search__input"
            value={q}
            onChange={e => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder="Search articles, guides and FAQs…"
            aria-label="Search the Knowledge Base"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
          />
          {fetching && (
            <span className="nw-search__spinner" role="status" aria-label="Finding suggestions">
              <span className="nv-spin nv-spin--sm nv-spin--w" />
            </span>
          )}

          {showList && (
            // mousedown keeps focus in the input so the click lands before onBlur closes the list
            <ul className="nw-suggest" id={listId} role="listbox" aria-label="Suggested articles" onMouseDown={e => e.preventDefault()}>
              {suggestions.length === 0 ? (
                <li className="nw-suggest__empty">No close matches. Press Enter to search anyway.</li>
              ) : (
                suggestions.map((s, i) => (
                  <li
                    key={`${s.categorySlug}/${s.slug}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={`nw-suggest__item${i === active ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => navigate(`/articles/${s.categorySlug}/${s.slug}`)}
                  >
                    <span className="nw-suggest__title">{s.title}</span>
                    <span className="nw-suggest__meta">
                      {s.categoryTitle}
                      {s.isPrivate && <> · <Icon name="lock" size={10} alt="Sign-in required" /> Members</>}
                    </span>
                  </li>
                ))
              )}
              <li className="nw-suggest__all" role="option" aria-selected={false} onClick={() => go(q)}>
                See all results for “{term}”
                <Icon name="arrow-right" size={14} />
              </li>
            </ul>
          )}
        </div>
        <button type="submit" className="nv-btn nv-btn--ondark nw-search__btn" disabled={navigating} aria-busy={navigating}>
          {navigating && <span className="nv-spin nv-spin--sm" aria-hidden="true" />}
          {navigating ? 'Searching…' : 'Search'}
        </button>
      </form>

      {popular.length > 0 && (
        <div className="nw-hero__popular">
          <span>Popular:</span>
          {popular.map(term => (
            <button key={term} type="button" onClick={() => go(term)} disabled={navigating}>{term}</button>
          ))}
        </div>
      )}
    </>
  )
}
