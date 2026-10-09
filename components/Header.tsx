'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Icon from './Icon'

export interface HeaderTopic {
  slug: string
  title: string
  description: string
  icon: string
  isPrivate: boolean
}

export interface HeaderUser {
  name: string
  email: string
}

interface Props {
  user: HeaderUser | null
  topics: HeaderTopic[]
}

// Header 85 (Figma 646:3) + mega-menu (642:2) + ≤900px drawer (responsive.md).
export default function Header({ user, topics }: Props) {
  const router = useRouter()
  const [megaOpen, setMegaOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTopics, setDrawerTopics] = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isStaff = !!user?.email.endsWith('@nuvho.com')
  const firstName = user?.name.split(' ')[0] ?? ''

  function openMega() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setMegaOpen(true)
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setMegaOpen(false), 140)
  }
  function closeAll() {
    setMegaOpen(false)
    setDrawerOpen(false)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleLogout() {
    // Stays true until the refreshed header (signed out) replaces these buttons
    setSigningOut(true)
    const res = await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    if (!res?.ok) {
      setSigningOut(false)
      return
    }
    closeAll()
    router.push('/')
    router.refresh()
  }

  return (
    <header className={`nw-header${megaOpen ? ' nw-header--open' : ''}`} onMouseLeave={scheduleClose}>
      <div className="nw-wrap nw-header__inner">
        <Link href="/" className="nw-header__logo" aria-label="Nuvho Knowledge Base — home">
          <Image src="/logo-primary.svg" alt="Nuvho" width={102} height={36} priority />
        </Link>

        <nav className="nw-nav" aria-label="Primary">
          <button
            type="button"
            className={`nw-nav__item${megaOpen ? ' nw-nav__item--active' : ''}`}
            onMouseEnter={openMega}
            onFocus={openMega}
            onClick={() => setMegaOpen(o => !o)}
            aria-expanded={megaOpen}
            aria-haspopup="true"
          >
            Topics
            <Icon name="angle-down" size={10} />
          </button>
          <Link href="/search" className="nw-nav__item" onMouseEnter={scheduleClose}>Search</Link>
          {isStaff && (
            <Link href="/admin" className="nw-nav__item" onMouseEnter={scheduleClose}>Admin</Link>
          )}
          <a href="https://nuvho.com" target="_blank" rel="noopener noreferrer" className="nw-nav__item" onMouseEnter={scheduleClose}>
            nuvho.com
          </a>
        </nav>

        <div className="nw-header__cta">
          {user ? (
            <>
              <span className="nw-header__user">Hello, {firstName}</span>
              <button type="button" onClick={handleLogout} disabled={signingOut} aria-busy={signingOut} className="nv-btn nv-btn--secondary nv-btn--header">
                {signingOut && <span className="nv-spin nv-spin--sm" aria-hidden="true" />}
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <>
              <Link href="/signup" className="nw-header__link">Create account</Link>
              <Link href="/login" className="nv-btn nv-btn--header">Sign in</Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="nw-header__toggle"
          onClick={() => setDrawerOpen(o => !o)}
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={drawerOpen}
        >
          <Icon name={drawerOpen ? 'xmark' : 'bars'} size={24} />
        </button>
      </div>

      {megaOpen && (
        <>
          <div className="nw-accent" aria-hidden="true" />
          <div className="nw-mega" onMouseEnter={openMega} onMouseLeave={scheduleClose}>
            <div className="nw-wrap nw-mega__inner">
              <div className="nw-mega__spot">
                <span className="nw-mega__sheet nw-mega__sheet--1" />
                <span className="nw-mega__sheet nw-mega__sheet--2" />
                <span className="nw-mega__sheet nw-mega__sheet--3" />
                <span className="nw-mega__scrim" />
                <h3>Topics</h3>
                <p>Guides, tutorials and documentation for Smart Hoteliers.</p>
              </div>
              <div className="nw-mega__divider" />
              <div className="nw-mega__cols">
                {topics.map(t => (
                  <Link key={t.slug} href={`/categories/${t.slug}`} className="nw-mega__item" onClick={closeAll}>
                    <Icon name={t.icon} size={28} />
                    <span className="nw-mega__text">
                      <strong>
                        {t.title}
                        {t.isPrivate && <Icon name="lock" size={12} alt="Sign-in required" />}
                      </strong>
                      <span>{t.description}</span>
                    </span>
                  </Link>
                ))}
                {topics.length === 0 && (
                  <Link href="/" className="nw-mega__item" onClick={closeAll}>
                    <Icon name="book-open" size={28} />
                    <span className="nw-mega__text">
                      <strong>Browse the Knowledge Base</strong>
                      <span>Topics appear here as they are published.</span>
                    </span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {drawerOpen && (
        <div className="nw-drawer">
          <button
            type="button"
            className={`nw-drawer__row${drawerTopics ? ' nw-drawer__row--open' : ''}`}
            onClick={() => setDrawerTopics(o => !o)}
            aria-expanded={drawerTopics}
          >
            Topics
            <Icon name="angle-down" size={12} />
          </button>
          {drawerTopics && (
            <div className="nw-drawer__sub">
              {topics.map(t => (
                <Link key={t.slug} href={`/categories/${t.slug}`} onClick={closeAll}>
                  <Icon name={t.icon} size={20} />
                  {t.title}
                  {t.isPrivate && <Icon name="lock" size={12} alt="Sign-in required" />}
                </Link>
              ))}
            </div>
          )}
          <Link href="/search" className="nw-drawer__row" onClick={closeAll}>Search</Link>
          {isStaff && <Link href="/admin" className="nw-drawer__row" onClick={closeAll}>Admin</Link>}
          <a href="https://nuvho.com" target="_blank" rel="noopener noreferrer" className="nw-drawer__row">nuvho.com</a>

          <div className="nw-drawer__cta">
            {user ? (
              <>
                <span className="nw-header__user">Hello, {firstName}</span>
                <button type="button" onClick={handleLogout} disabled={signingOut} aria-busy={signingOut} className="nv-btn nv-btn--secondary">
                  {signingOut && <span className="nv-spin nv-spin--sm" aria-hidden="true" />}
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="nv-btn" onClick={closeAll}>Sign in</Link>
                <Link href="/signup" className="nw-header__link" onClick={closeAll}>Create account</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
