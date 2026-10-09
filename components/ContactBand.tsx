// The page's one spotlight (nuvho-web-design v2 §3, Brand Book pp. 29–30, 50): Home has
// no other spotlight, so the CTA takes it. Blend GROUND from the #28687F floor, 120px
// top-right house curve over a Platinum notch, glow + one sheet + copy scrim, grain last.
export default function ContactBand() {
  return (
    <div className="nw-curve-fill">
      <section className="nw-band nw-band--spot">
        <span className="nw-band__glow" aria-hidden="true" />
        <span className="nw-band__sheet" aria-hidden="true" />
        <span className="nw-band__scrim" aria-hidden="true" />
        <span className="nw-grain" aria-hidden="true" />
        <div className="nw-wrap nw-band__inner">
          <h2>Can&apos;t find what you&apos;re looking for?</h2>
          <p>
            Tell us what you were trying to do and we&apos;ll point you to the right answer —
            or write the article if it doesn&apos;t exist yet.
          </p>
          <div className="nw-band__actions">
            <a href="mailto:support@nuvho.com" className="nv-btn nv-btn--ondark nw-band__btn">Email support</a>
            <a href="https://nuvho.com/contact" target="_blank" rel="noopener noreferrer" className="nv-btn nv-btn--ondark-alt nw-band__btn">
              Speak to our Experts
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
