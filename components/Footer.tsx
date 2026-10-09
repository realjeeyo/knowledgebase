import Image from 'next/image'
import Link from 'next/link'
import Icon from './Icon'

// Footer 512 · Iron Grey (Figma 656:2). Social marks are the four brand marks from the
// Figma footer component (public/social/) — the one permitted non-library glyph set.
// Copyright follows brand law ("© Nuvho Holdings Pty Ltd", nuvho-brand v4), not the
// wireframe's "© Nuvho Pty Ltd". No AU / UK / IE region switcher — the KB has no
// regional content (flagged deviation from the nuvho.com footer).
const social = [
  { label: 'LinkedIn',  href: 'https://linkedin.com/company/nuvho', file: 'linkedin.svg',  size: 19 },
  { label: 'Facebook',  href: 'https://facebook.com/nuvho',         file: 'facebook.svg',  size: 20 },
  { label: 'Instagram', href: 'https://instagram.com/nuvho',        file: 'instagram.svg', size: 20 },
  { label: 'YouTube',   href: 'https://youtube.com/@nuvho',         file: 'youtube.svg',   size: 16 },
]

export default function Footer() {
  return (
    <footer className="nw-footer">
      <div className="nw-wrap">
        <div className="nw-footer__top">
          <div>
            <Link href="/" className="nw-footer__logo" aria-label="Nuvho — home">
              <Image src="/logo-white.svg" alt="Nuvho — Smart Hoteliers" width={307} height={108} />
            </Link>

            <div className="nw-footer__contact">
              <a href="mailto:support@nuvho.com">
                <Icon name="envelope" size={16} onDark />
                support@nuvho.com
              </a>
              <span>
                <Icon name="location-dot" size={16} onDark />
                Oceania · UK · EU · Philippines
              </span>
            </div>

            <div className="nw-footer__social">
              {social.map(s => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/social/${s.file}`} alt="" width={s.size} height={s.size} />
                </a>
              ))}
            </div>
          </div>

          <div className="nw-footer__cols">
            <div>
              <h4>Knowledge Base</h4>
              <Link href="/">Home</Link>
              <Link href="/#topics">Browse topics</Link>
              <Link href="/search">Search</Link>
              <Link href="/login">Sign in</Link>
            </div>
            <div>
              <h4>Nuvho</h4>
              <a href="https://nuvho.com" target="_blank" rel="noopener noreferrer">nuvho.com</a>
              <a href="https://nuvho.com/case-studies" target="_blank" rel="noopener noreferrer">Case Studies</a>
              <a href="https://nuvho.com/about-us" target="_blank" rel="noopener noreferrer">About Us</a>
              <a href="https://nuvho.com/contact" target="_blank" rel="noopener noreferrer">Contact Us</a>
            </div>
            <div>
              <h4>Support</h4>
              <a href="mailto:support@nuvho.com">Email support</a>
              <a href="https://nuvho.com/contact" target="_blank" rel="noopener noreferrer">Speak to our Experts</a>
              <Link href="/signup">Create an account</Link>
            </div>
          </div>
        </div>

        <div className="nw-footer__rule" />

        <div className="nw-footer__legal">
          <span>© Nuvho Holdings Pty Ltd {new Date().getFullYear()}</span>
          <div>
            <a href="https://nuvho.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            <a href="https://nuvho.com/terms" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
