"use client";

/* eslint-disable @next/next/no-img-element -- Product captures are pre-optimized WebP assets. */
import { useEffect, useRef, useState } from "react";
import {
  faqs,
  features,
  gallery,
  navigation,
  securityPoints,
  site,
  steps,
  trustPoints,
} from "@/content";

type CopyState = "idle" | "copied" | "failed";

export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | null | undefined =
    typeof navigator === "undefined" ? undefined : navigator.clipboard,
  doc: Document | null | undefined = typeof document === "undefined"
    ? undefined
    : document,
): Promise<boolean> {
  if (clipboard?.writeText) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Clipboard timed out")), 1000);
        clipboard.writeText(text).then(
          () => {
            clearTimeout(timeout);
            resolve();
          },
          (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        );
      });
      return true;
    } catch {
      // Continue to the selection-based fallback below.
    }
  }
  try {
    if (!doc) return false;
    const field = doc.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    doc.body.appendChild(field);
    field.select();
    const copied = doc.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

function CommandBlock({ command, compact = false }: { command: string; compact?: boolean }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function handleCopy() {
    const copied = await copyText(command);
    setState(copied ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 10_000);
  }

  const label = state === "copied" ? "Copied" : state === "failed" ? "Select command" : "Copy";

  return (
    <div className={`command-block${compact ? " command-block--compact" : ""}`}>
      <span aria-hidden="true" className="command-prompt">$</span>
      <code>{command}</code>
      <button type="button" onClick={handleCopy} aria-live="polite">
        <span className="copy-icon" aria-hidden="true">{state === "copied" ? "✓" : "▢"}</span>
        {label}
      </button>
    </div>
  );
}

export function MarketingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.body.dataset.menuOpen = menuOpen ? "true" : "false";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      delete document.body.dataset.menuOpen;
    };
  }, [menuOpen]);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.dataset.visible = "true");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.visible = "true";
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10%", threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="nav-shell">
          <a className="wordmark" href="#top" aria-label="Mobily home">
            <span className="wordmark-mark" aria-hidden="true">&gt;_</span>
            <span>mobily</span>
          </a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
          </nav>
          <div className="nav-actions">
            <a className="github-link" href={site.urls.repository} target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
            <a className="button button--small" href="#get-started">Get started</a>
          </div>
          <button
            className="menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
          </button>
        </div>
        <nav id="mobile-menu" className="mobile-nav" aria-label="Mobile navigation" hidden={!menuOpen}>
          {navigation.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>
          ))}
          <a href={site.urls.repository} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
          <a className="button" href="#get-started" onClick={() => setMenuOpen(false)}>Get started</a>
        </nav>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-glow hero-glow--one" aria-hidden="true" />
          <div className="hero-glow hero-glow--two" aria-hidden="true" />
          <div className="container hero-layout">
            <div className="hero-copy" data-reveal data-visible="true">
              <div className="eyebrow"><span className="status-dot" /> Android beta · Open source</div>
              <h1>Keep your terminal <span>within reach.</span></h1>
              <p className="hero-lede">{site.description}</p>
              <div className="hero-actions">
                <a className="button button--primary" href="#get-started">Get started <span aria-hidden="true">↓</span></a>
                <a className="button button--ghost" href={site.urls.repository} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
              </div>
              <CommandBlock command={site.command} compact />
              <p className="hero-note">Node.js 20+ · macOS, Linux, Windows & WSL</p>
            </div>

            <div className="hero-product" data-reveal data-visible="true">
              <div className="signal-orbit signal-orbit--one" aria-hidden="true" />
              <div className="signal-orbit signal-orbit--two" aria-hidden="true" />
              <div className="phone phone--hero">
                <div className="phone-top" aria-hidden="true"><span /></div>
                <div className="phone-screen">
                  <img
                    src="/product/terminal.webp"
                    alt="Mobily connected to a live terminal Session on an Android phone"
                    width={1080}
                    height={2400}
                    loading="eager"
                    fetchPriority="high"
                    sizes="(max-width: 760px) 78vw, 390px"
                  />
                </div>
              </div>
              <div className="floating-card floating-card--status">
                <span className="status-dot" />
                <div><strong>Connected</strong><small>studio-workstation</small></div>
              </div>
              <div className="floating-card floating-card--prompt">
                <span className="floating-icon">!</span>
                <div><strong>Terminal needs you</strong><small>Permission requested</small></div>
              </div>
            </div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Mobily at a glance">
          <div className="container trust-grid">
            {trustPoints.map((point) => (
              <div className="trust-point" key={point.label}>
                <span>{point.mark}</span><strong>{point.label}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="section problem-section">
          <div className="container problem-grid">
            <div data-reveal>
              <p className="section-kicker">WORK DOESN&apos;T ALWAYS WAIT</p>
              <h2>Step away without <span>dropping the thread.</span></h2>
            </div>
            <div className="problem-copy" data-reveal>
              <p>Your build is still running. Your agent is waiting for permission. A quick fix needs one command—but your laptop is across the room.</p>
              <p>Mobily keeps a secure line to the Session already running on your workstation. Check in, respond, and keep the work moving from Android.</p>
            </div>
          </div>
        </section>

        <section className="section feature-section" id="features">
          <div className="container">
            <div className="section-heading" data-reveal>
              <div><p className="section-kicker">BUILT FOR THE WORK BETWEEN DESKS</p><h2>Full control. <span>Less friction.</span></h2></div>
              <p>Everything you need to stay close to a development Session without squeezing a desktop interface onto a phone.</p>
            </div>
            <div className="feature-grid">
              {features.map((feature, index) => (
                <article className={`feature-card feature-card--${index + 1}`} key={feature.title} data-reveal>
                  <div className="feature-top"><span className="feature-mark">{feature.mark}</span><span className="feature-eyebrow">{feature.eyebrow}</span></div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section steps-section" id="how-it-works">
          <div className="container">
            <div className="section-heading section-heading--center" data-reveal>
              <div><p className="section-kicker">FROM DESK TO POCKET</p><h2>Three steps. <span>One continuous Session.</span></h2></div>
              <p>No accounts with Mobily. No project upload. Pair the devices you own and carry on.</p>
            </div>
            <div className="steps-grid">
              {steps.map((step, index) => (
                <article className="step-card" key={step.number} data-reveal>
                  <span className="step-number">{step.number}</span>
                  <div className="step-visual" aria-hidden="true">
                    {index === 0 && <div className="mini-terminal"><i>● ● ●</i><code><b>$</b> npx mobily</code><code><em>✓</em> Session ready</code></div>}
                    {index === 1 && <div className="mini-qr"><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>}
                    {index === 2 && <div className="mini-link"><span>&gt;_</span><i /><span>M</span></div>}
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section gallery-section" aria-labelledby="gallery-title">
          <div className="container">
            <div className="section-heading" data-reveal>
              <div><p className="section-kicker">THE REAL ANDROID EXPERIENCE</p><h2 id="gallery-title">Purpose-built for <span>small screens.</span></h2></div>
              <p>Terminal, Stations, and Git are separate native-feeling surfaces—not a shrunken desktop dashboard.</p>
            </div>
            <div className="gallery-grid">
              {gallery.map((item, index) => (
                <figure className={`gallery-item gallery-item--${index + 1}`} key={item.label} data-reveal>
                  <div className="gallery-phone">
                    <div className="gallery-speaker" aria-hidden="true" />
                    <img src={item.src} alt={item.alt} width={1080} height={2400} loading="lazy" decoding="async" sizes="(max-width: 760px) 75vw, 320px" />
                  </div>
                  <figcaption><strong>{item.label}</strong><span>{item.description}</span></figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="section security-section" id="security">
          <div className="container security-grid">
            <div className="security-copy" data-reveal>
              <p className="section-kicker">SECURE BY OWNERSHIP</p>
              <h2>Your machine. Your phone. <span>Your keys.</span></h2>
              <p className="security-lede">Mobily connects the devices you control. It never asks you to hand your source code or terminal history to a Mobily service.</p>
              <a className="text-link" href={site.urls.security} target="_blank" rel="noreferrer">Read the security audit <span aria-hidden="true">↗</span></a>
            </div>
            <div className="security-panel" data-reveal>
              <div className="security-core" aria-hidden="true"><span>KEY</span><i /><i /><i /></div>
              <div className="security-list">
                {securityPoints.map((point, index) => (
                  <div className="security-item" key={point.title}><span>0{index + 1}</span><div><h3>{point.title}</h3><p>{point.description}</p></div></div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section setup-section" id="get-started">
          <div className="container setup-card" data-reveal>
            <div className="setup-glow" aria-hidden="true" />
            <div className="setup-heading">
              <p className="section-kicker">GET STARTED</p>
              <h2>Your terminal, <span>one scan away.</span></h2>
              <p>Start Mobily on your workstation, then install the Android beta from GitHub Releases.</p>
            </div>
            <div className="setup-actions">
              <div className="setup-step"><span>1</span><div><strong>Run on your workstation</strong><CommandBlock command={site.command} /></div></div>
              <div className="setup-divider"><span>THEN</span></div>
              <div className="setup-step"><span>2</span><div><strong>Install on Android</strong><a className="button button--primary button--download" href={site.urls.releases} target="_blank" rel="noreferrer">Download latest APK <span aria-hidden="true">↓</span></a><small>Signed beta builds are published through GitHub Releases.</small></div></div>
            </div>
            <div className="local-note"><span aria-hidden="true">⌁</span><p><strong>On the same Wi-Fi?</strong> Use <code>{site.localCommand}</code> for account-free access with pinned TLS.</p></div>
          </div>
        </section>

        <section className="section faq-section" id="faq">
          <div className="container faq-grid">
            <div className="faq-heading" data-reveal><p className="section-kicker">QUESTIONS, ANSWERED</p><h2>The details <span>developers ask.</span></h2><p>Mobily is intentionally small, explicit, and open. The source is there when you want the full story.</p><a className="text-link" href={site.urls.readme} target="_blank" rel="noreferrer">Read the documentation <span aria-hidden="true">↗</span></a></div>
            <div className="faq-list" data-reveal>
              {faqs.map((faq) => <details key={faq.question}><summary>{faq.question}<span aria-hidden="true">+</span></summary><p>{faq.answer}</p></details>)}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-main">
          <div><a className="wordmark" href="#top"><span className="wordmark-mark" aria-hidden="true">&gt;_</span><span>mobily</span></a><p>A secure Android companion for terminal-based development.</p></div>
          <div className="footer-links"><a href={site.urls.repository} target="_blank" rel="noreferrer">GitHub</a><a href={site.urls.releases} target="_blank" rel="noreferrer">Releases</a><a href={site.urls.readme} target="_blank" rel="noreferrer">Documentation</a><a href={site.urls.security} target="_blank" rel="noreferrer">Security</a></div>
        </div>
        <div className="container footer-bottom"><span>© {new Date().getFullYear()} Mobily contributors</span><a href={site.urls.license} target="_blank" rel="noreferrer">MIT licensed</a><span>Built in the open.</span></div>
      </footer>
    </>
  );
}
