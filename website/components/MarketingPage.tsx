'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  faqs,
  features,
  navigation,
  proofPoints,
  securityFlow,
  securityPoints,
  site,
  workflow,
} from '@/content';

type KeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey'>;

export function getMenuFocusWrapTarget(
  event: KeyEvent,
  activeElement: Element | null,
  focusable: HTMLElement[],
) {
  if (event.key !== 'Tab' || focusable.length === 0) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && activeElement === first) return last;
  if (!event.shiftKey && activeElement === last) return first;
  return null;
}

export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | null | undefined = typeof navigator === 'undefined'
    ? null
    : navigator.clipboard,
  doc: Document | null = typeof document === 'undefined' ? null : document,
) {
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Continue to the legacy fallback when permission is denied.
    }
  }
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const field = doc.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  doc.body.appendChild(field);
  field.select();
  const copied = doc.execCommand('copy');
  field.remove();
  return copied;
}

function Wordmark() {
  return (
    <span className="wordmark-lockup" aria-label="Mobily">
      <span className="wordmark-mark" aria-hidden="true">
        &gt;_
      </span>
      <span>MOBILY</span>
    </span>
  );
}

function CommandBlock({ command, compact = false }: { command: string; compact?: boolean }) {
  const [status, setStatus] = useState('COPY');

  const handleCopy = useCallback(async () => {
    const copied = await copyText(command);
    setStatus(copied ? 'COPIED' : 'SELECT');
    window.setTimeout(() => setStatus('COPY'), 1800);
  }, [command]);

  return (
    <div className={`command-block${compact ? ' command-block--compact' : ''}`}>
      <span className="command-prompt" aria-hidden="true">
        $
      </span>
      <code>{command}</code>
      <button type="button" onClick={handleCopy} aria-label={`Copy command: ${command}`}>
        <span aria-live="polite">{status}</span>
      </button>
    </div>
  );
}

function ProductFrame({
  src,
  alt,
  className = '',
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div className={`product-frame ${className}`}>
      <div className="product-frame-bar" aria-hidden="true">
        <span>MOBILY / ANDROID</span>
        <span>LIVE PRODUCT</span>
      </div>
      {/* The images are authentic Android captures and intentionally remain unchanged. */}
      <Image src={src} alt={alt} width={920} height={2048} sizes="(max-width: 900px) 78vw, 320px" />
    </div>
  );
}

function SectionHeading({
  index,
  label,
  title,
  body,
  inverse = false,
  className = '',
}: {
  index: string;
  label: string;
  title: React.ReactNode;
  body?: string;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`section-heading${inverse ? ' section-heading--inverse' : ''}${className ? ` ${className}` : ''}`}
    >
      <p className="section-kicker">
        <span>{index}</span> / {label}
      </p>
      <h2 className="section-title">{title}</h2>
      {body && <p className="section-body">{body}</p>}
    </div>
  );
}

export function MarketingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerCompact, setHeaderCompact] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [activeStory, setActiveStory] = useState<string>(workflow[0].id);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    document.body.dataset.menuOpen = menuOpen ? 'true' : 'false';
    if (!menuOpen) return () => delete document.body.dataset.menuOpen;

    const menu = mobileMenuRef.current;
    const focusable = Array.from(
      menu?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
    );
    focusable[0]?.focus();

    function handleMenuKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      const wrapTarget = getMenuFocusWrapTarget(event, document.activeElement, focusable);
      if (wrapTarget) {
        event.preventDefault();
        wrapTarget.focus();
      }
    }

    document.addEventListener('keydown', handleMenuKeydown);
    return () => {
      document.removeEventListener('keydown', handleMenuKeydown);
      delete document.body.dataset.menuOpen;
    };
  }, [closeMenu, menuOpen]);

  useEffect(() => {
    const onScroll = () => setHeaderCompact(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const sections = navigation
      .map((item) => document.querySelector<HTMLElement>(item.href))
      .filter((section): section is HTMLElement => Boolean(section));
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) setActiveSection(visible[visible.length - 1].target.id);
      },
      { rootMargin: '-28% 0px -62%', threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const chapters = document.querySelectorAll<HTMLElement>('[data-story-chapter]');
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          setActiveStory((visible.target as HTMLElement).dataset.storyChapter ?? workflow[0].id);
        }
      },
      { rootMargin: '-22% 0px -52%', threshold: [0.2, 0.45, 0.7] },
    );
    chapters.forEach((chapter) => observer.observe(chapter));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.revealReady = 'true';
    const elements = document.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      elements.forEach((element) => {
        element.dataset.visible = 'true';
      });
      return () => {
        delete document.documentElement.dataset.revealReady;
      };
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.visible = 'true';
            observer.unobserve(entry.target);
          }
        }),
      { rootMargin: '0px 0px -7%', threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      delete document.documentElement.dataset.revealReady;
    };
  }, []);

  const activeStoryIndex = workflow.findIndex((item) => item.id === activeStory);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`site-header${headerCompact ? ' site-header--compact' : ''}`}>
        <div className="nav-shell">
          <a className="wordmark" href="#top">
            <Wordmark />
          </a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navigation.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={activeSection === item.href.slice(1) ? 'location' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="nav-actions">
            <a
              className="nav-text-link"
              href={site.urls.repository}
              target="_blank"
              rel="noreferrer"
            >
              GITHUB ↗
            </a>
            <a
              className="button button--small button--inverse"
              href={site.urls.releases}
              target="_blank"
              rel="noreferrer"
            >
              GET APK ↓
            </a>
          </div>
          <button
            ref={menuButtonRef}
            className="menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => (menuOpen ? closeMenu(true) : setMenuOpen(true))}
          >
            <span>{menuOpen ? 'CLOSE' : 'MENU'}</span>
            <i aria-hidden="true">{menuOpen ? '×' : '='}</i>
          </button>
        </div>
        <div
          ref={mobileMenuRef}
          id="mobile-menu"
          className="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          hidden={!menuOpen}
        >
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {navigation.map((item, index) => (
              <a key={item.href} href={item.href} onClick={() => closeMenu()}>
                <span>0{index + 1}</span>
                <strong>{item.label}</strong>
                <span>↘</span>
              </a>
            ))}
            <a href={site.urls.repository} target="_blank" rel="noreferrer">
              <span>05</span>
              <strong>GitHub</strong>
              <span>↗</span>
            </a>
            <a
              className="button button--inverse"
              href={site.urls.releases}
              target="_blank"
              rel="noreferrer"
              onClick={() => closeMenu()}
            >
              GET ANDROID APK ↓
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="container hero-grid">
            <div className="hero-copy">
              <p className="hero-kicker">
                <span className="status-dot status-dot--success" /> OPEN SOURCE · ANDROID · TERMINAL
                COMPANION
              </p>
              <h1>
                <span>The terminal</span>
                <span>stays with you.</span>
              </h1>
              <p className="hero-lede">{site.description}</p>
              <div className="hero-actions">
                <a className="button button--inverse" href="#get-started">
                  START A SESSION ↓
                </a>
                <a className="button" href={site.urls.releases} target="_blank" rel="noreferrer">
                  GET ANDROID APK ↗
                </a>
              </div>
              <CommandBlock command={site.command} compact />
              <p className="hero-note">
                FIRST REMOTE RUN MAY REQUEST GITHUB OR MICROSOFT AUTHENTICATION.
              </p>
            </div>

            <div className="hero-product" aria-label="Mobily product preview">
              <div className="hero-product-meta">
                <span>LIVE / 01</span>
                <span>ANDROID BETA</span>
              </div>
              <div className="hero-terminal" aria-hidden="true">
                <div className="terminal-title">
                  <span>STATION</span>
                  <span>studio-workstation</span>
                </div>
                <code>
                  <b>$</b> npx mobily --tunnel devtunnels
                </code>
                <code>
                  <i>✓</i> secure transport ready
                </code>
                <code>
                  <i>✓</i> Session mobily-main live
                </code>
                <code>
                  <span>›</span> scan the one-time QR to pair
                </code>
              </div>
              <div className="hero-phone">
                <Image
                  src="/product/terminal.webp"
                  alt="A live Mobily terminal Session on an Android phone"
                  width={920}
                  height={2048}
                  sizes="(max-width: 900px) 62vw, 310px"
                  loading="eager"
                />
              </div>
              <div className="hero-status">
                <span className="status-dot status-dot--success" />
                <div>
                  <strong>SESSION LIVE</strong>
                  <small>studio-workstation</small>
                </div>
              </div>
            </div>
          </div>
          <div className="container hero-index" aria-hidden="true">
            <span>01</span>
            <span>REMOTE TERMINAL / ANDROID</span>
            <span>SCROLL ↓</span>
          </div>
        </section>

        <section className="proof-strip" aria-label="Mobily at a glance">
          <div className="container proof-grid">
            {proofPoints.map((point, index) => (
              <div className="proof-point" key={point.label}>
                <span className="proof-number">0{index + 1}</span>
                <strong>{point.mark}</strong>
                <div>
                  <b>{point.label}</b>
                  <small>{point.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="workflow-section" id="how-it-works">
          <div className="container">
            <SectionHeading
              className="section-heading--workflow"
              index="01"
              label="WORKFLOW"
              title={
                <>
                  <span className="section-title-line section-title-line--ink">From PC to</span>
                  <span className="section-title-line section-title-line--ink">pocket.</span>
                  <span className="section-title-line">Same Session.</span>
                  <span className="section-title-line">Same Terminal.</span>
                  <span className="section-title-line">Full Control.</span>
                </>
              }
              body="Pair once, keep the terminal visible, move between Stations, and close the small loops that would otherwise send you back to the desk."
            />
            <div className="workflow-layout">
              <div className="workflow-stage" aria-live="polite">
                <div className="workflow-stage-meta">
                  <span>{workflow[activeStoryIndex]?.status}</span>
                  <span>{String(activeStoryIndex + 1).padStart(2, '0')} / 04</span>
                </div>
                <div className="workflow-screens">
                  {workflow.map((item) => (
                    <div
                      className="workflow-screen"
                      data-active={item.id === activeStory}
                      key={item.id}
                    >
                      <ProductFrame src={item.src} alt={item.alt} />
                    </div>
                  ))}
                </div>
                <div className="workflow-meter" role="tablist" aria-label="Workflow steps">
                  {workflow.map((item) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={item.id === activeStory}
                      aria-label={`${item.number} ${item.eyebrow}`}
                      data-active={item.id === activeStory}
                      key={item.id}
                      onClick={() => {
                        setActiveStory(item.id);
                        document
                          .querySelector<HTMLElement>(`[data-story-chapter="${item.id}"]`)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="workflow-chapters">
                {workflow.map((item) => (
                  <article
                    className="workflow-chapter"
                    data-story-chapter={item.id}
                    data-active={item.id === activeStory}
                    key={item.id}
                  >
                    <div className="workflow-mobile-visual">
                      <ProductFrame src={item.src} alt={item.alt} />
                    </div>
                    <div className="chapter-meta">
                      <span>{item.number}</span>
                      <span>{item.eyebrow}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="features-section" id="features">
          <div className="container">
            <SectionHeading
              index="02"
              label="CONTROL SURFACES"
              title={
                <>
                  <span className="section-title-line section-title-line--ink">
                    Built for the moments
                  </span>
                  <span className="section-title-line">that unblock work.</span>
                </>
              }
              body="Mobily does not shrink a desktop dashboard into a phone. It gives consequential terminal and Git actions a direct mobile surface."
            />
            <div className="feature-grid">
              {features.map((feature, index) => (
                <article className="feature-card" key={feature.title} data-reveal>
                  <div className="feature-meta">
                    <span>0{index + 1}</span>
                    <span>{feature.meta}</span>
                  </div>
                  <span className="feature-mark" aria-hidden="true">
                    {feature.mark}
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="security-section" id="security">
          <div className="container security-grid">
            <div className="security-copy" data-reveal>
              <SectionHeading
                index="03"
                label="TRUST MODEL"
                title={
                  <>
                    <span className="section-title-line section-title-line--ink">
                      Your machine.
                    </span>
                    <span className="section-title-line section-title-line--ink">Your phone.</span>
                    <span className="section-title-line">Your keys.</span>
                  </>
                }
                body="The private Device Key stays in Android Keystore. Each reconnect signs a fresh challenge; the CLI verifies it before opening the Session."
              />
              <a className="text-link" href={site.urls.security} target="_blank" rel="noreferrer">
                READ THE SECURITY MODEL ↗
              </a>
            </div>
            <div className="security-model" data-reveal>
              <div
                className="security-route"
                aria-label="Secure connection from Station to Android"
              >
                {securityFlow.map((node, index) => (
                  <div className="security-node-wrap" key={node.label}>
                    <div className="security-node">
                      <span>{node.mark}</span>
                      <div>
                        <strong>{node.label}</strong>
                        <small>{node.detail}</small>
                      </div>
                    </div>
                    {index < securityFlow.length - 1 && (
                      <div className="security-connector" aria-hidden="true">
                        <i />
                        <b>{index === 0 ? 'ENCRYPT' : 'VERIFY'}</b>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="security-proofs">
                {securityPoints.map((point, index) => (
                  <article key={point.title}>
                    <span>0{index + 1}</span>
                    <div>
                      <h3>{point.title}</h3>
                      <p>{point.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="setup-section" id="get-started">
          <div className="container setup-grid">
            <SectionHeading
              index="04"
              label="START"
              inverse
              title={
                <>
                  <span className="section-title-line section-title-line--ink">One command.</span>
                  <span className="section-title-line">One scan.</span>
                </>
              }
              body="Start the CLI on your Station, then install the signed Android beta. The first Dev Tunnels run guides authentication and setup."
            />
            <div className="setup-console">
              <div className="setup-console-title">
                <span>QUICK START</span>
                <span>NODE.JS 20+</span>
              </div>
              <div className="setup-step">
                <span>01</span>
                <div>
                  <strong>RUN ON YOUR STATION</strong>
                  <CommandBlock command={site.command} />
                </div>
              </div>
              <div className="setup-step">
                <span>02</span>
                <div>
                  <strong>INSTALL ON ANDROID</strong>
                  <a
                    className="button button--paper"
                    href={site.urls.releases}
                    target="_blank"
                    rel="noreferrer"
                  >
                    DOWNLOAD LATEST APK ↓
                  </a>
                  <small>Signed beta builds are published through GitHub Releases.</small>
                </div>
              </div>
              <div className="local-callout">
                <span className="status-dot status-dot--success" />
                <p>
                  <strong>SAME WI-FI?</strong> Run <code>{site.localCommand}</code> for account-free
                  pinned TLS.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="faq-section" id="faq">
          <div className="container faq-grid">
            <div data-reveal>
              <SectionHeading
                index="05"
                label="FAQ"
                title={
                  <>
                    <span className="section-title-line section-title-line--ink">The details</span>
                    <span className="section-title-line">developers ask.</span>
                  </>
                }
                body="Mobily is intentionally small, explicit, and open. The repository carries the complete technical story."
              />
              <a className="text-link" href={site.urls.readme} target="_blank" rel="noreferrer">
                READ THE DOCUMENTATION ↗
              </a>
            </div>
            <div className="faq-list" data-reveal>
              {faqs.map((faq, index) => (
                <details key={faq.question}>
                  <summary>
                    <span>0{index + 1}</span>
                    <strong>{faq.question}</strong>
                    <i aria-hidden="true">+</i>
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <a className="wordmark" href="#top">
              <Wordmark />
            </a>
            <p>A secure Android companion for terminal-based development.</p>
          </div>
          <p className="footer-statement">
            THE TERMINAL
            <br />
            STAYS WITH YOU.
          </p>
          <div className="footer-links">
            <a href={site.urls.repository} target="_blank" rel="noreferrer">
              GITHUB ↗
            </a>
            <a href={site.urls.releases} target="_blank" rel="noreferrer">
              RELEASES ↗
            </a>
            <a href={site.urls.readme} target="_blank" rel="noreferrer">
              DOCUMENTATION ↗
            </a>
            <a href={site.urls.security} target="_blank" rel="noreferrer">
              SECURITY ↗
            </a>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} MOBILY CONTRIBUTORS</span>
          <a href={site.urls.license} target="_blank" rel="noreferrer">
            MIT LICENSED ↗
          </a>
          <span>BUILT IN THE OPEN.</span>
        </div>
      </footer>
    </>
  );
}
