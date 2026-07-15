"use client";

/* eslint-disable @next/next/no-img-element -- Authentic product captures are pre-optimized WebP assets. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  faqs,
  features,
  navigation,
  productStory,
  securityFlow,
  securityPoints,
  site,
  trustPoints,
} from "@/content";

type CopyState = "idle" | "copied" | "failed";

export function getMenuFocusWrapTarget(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
  activeElement: Element | null,
  focusable: readonly HTMLElement[],
): HTMLElement | null {
  if (event.key !== "Tab" || focusable.length === 0) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && activeElement === first) return last;
  if (!event.shiftKey && activeElement === last) return first;
  return null;
}

export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | null | undefined =
    typeof navigator === "undefined" ? undefined : navigator.clipboard,
  doc: Document | null | undefined =
    typeof document === "undefined" ? undefined : document,
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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

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

function Wordmark() {
  return (
    <span className="wordmark-lockup">
      <span className="wordmark-mark" aria-hidden="true">&gt;_</span>
      <span>mobily</span>
    </span>
  );
}

function PhoneFrame({
  src,
  alt,
  eager = false,
  className = "",
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <div className={`phone-frame ${className}`}>
      <div className="phone-hardware" aria-hidden="true"><span /></div>
      <div className="phone-screen">
        <img
          src={src}
          alt={alt}
          width={1080}
          height={2400}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding={eager ? "auto" : "async"}
          sizes="(max-width: 760px) 78vw, 390px"
        />
      </div>
    </div>
  );
}

function FeatureVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="feature-demo feature-demo--terminal" aria-hidden="true">
        <div><span>~/code/mobily</span><em>main</em></div>
        <code><b>❯</b> pnpm test</code>
        <code><i>✓</i> 126 tests passed</code>
        <code className="feature-cursor"><b>❯</b> <span /></code>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="feature-demo feature-demo--session" aria-hidden="true">
        <span className="session-ring" /><span className="session-ring" />
        <strong>∞</strong><small>SESSION ALIVE</small>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="feature-demo feature-demo--alert" aria-hidden="true">
        <span className="status-dot" />
        <div><strong>Terminal needs you</strong><small>Permission requested · now</small></div>
      </div>
    );
  }
  if (index === 3) {
    return (
      <div className="feature-demo feature-demo--diff" aria-hidden="true">
        <code><span>81</span><del>- inject(data)</del></code>
        <code><span>81</span><ins>+ post(message)</ins></code>
        <code><span>82</span><ins>+ [webViewRef]</ins></code>
      </div>
    );
  }
  if (index === 4) {
    return (
      <div className="feature-demo feature-demo--stations" aria-hidden="true">
        <span><i /><b>studio-workstation</b><small>online</small></span>
        <span><i /><b>devbox-wsl</b><small>online</small></span>
        <span><i /><b>home-server</b><small>offline</small></span>
      </div>
    );
  }
  return (
    <div className="feature-demo feature-demo--network" aria-hidden="true">
      <span>&gt;_</span><i><b>DEV TUNNEL</b><b>PINNED TLS</b></i><span>KEY</span>
    </div>
  );
}

export function MarketingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerCompact, setHeaderCompact] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const [activeStory, setActiveStory] = useState<string>(productStory[0].id);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    document.body.dataset.menuOpen = menuOpen ? "true" : "false";
    if (!menuOpen) return () => delete document.body.dataset.menuOpen;

    const menu = mobileMenuRef.current;
    const focusable = Array.from(
      menu?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
    );
    focusable[0]?.focus();

    function handleMenuKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
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

    document.addEventListener("keydown", handleMenuKeydown);
    return () => {
      document.removeEventListener("keydown", handleMenuKeydown);
      delete document.body.dataset.menuOpen;
    };
  }, [closeMenu, menuOpen]);

  useEffect(() => {
    const hero = document.querySelector("#top");
    if (!hero || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderCompact(!entry.isIntersecting),
      { rootMargin: "-80px 0px 0px", threshold: 0.08 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sections = navigation
      .map((item) => document.querySelector<HTMLElement>(item.href))
      .filter((section): section is HTMLElement => Boolean(section));
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) setActiveSection(visible[visible.length - 1].target.id);
      },
      { rootMargin: "-30% 0px -60%", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const chapters = document.querySelectorAll<HTMLElement>("[data-story-chapter]");
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveStory((visible.target as HTMLElement).dataset.storyChapter ?? productStory[0].id);
      },
      { rootMargin: "-24% 0px -48%", threshold: [0.15, 0.35, 0.6] },
    );
    chapters.forEach((chapter) => observer.observe(chapter));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.revealReady = "true";
    const elements = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => { element.dataset.visible = "true"; });
      return () => { delete document.documentElement.dataset.revealReady; };
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
      { rootMargin: "0px 0px -8%", threshold: 0.06 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      delete document.documentElement.dataset.revealReady;
    };
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className={`site-header${headerCompact ? " site-header--compact" : ""}`}>
        <div className="nav-shell">
          <a className="wordmark" href="#top" aria-label="Mobily home"><Wordmark /></a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} aria-current={activeSection === item.href.slice(1) ? "location" : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="nav-actions">
            <a className="github-link" href={site.urls.repository} target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
            <a className="button button--small" href="#get-started">Get started</a>
          </div>
          <button
            ref={menuButtonRef}
            className="menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => (menuOpen ? closeMenu(true) : setMenuOpen(true))}
          >
            <span /><span />
          </button>
        </div>
        <div ref={mobileMenuRef} id="mobile-menu" className="mobile-menu" role="dialog" aria-modal="true" aria-label="Navigation menu" hidden={!menuOpen}>
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {navigation.map((item, index) => (
              <a key={item.href} href={item.href} onClick={() => closeMenu()}><span>0{index + 1}</span>{item.label}</a>
            ))}
            <a href={site.urls.repository} target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
            <a className="button button--primary" href="#get-started" onClick={() => closeMenu()}>Get started</a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="ambient-grid" aria-hidden="true" />
          <div className="hero-signal" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="container hero-layout">
            <div className="hero-copy" data-visible="true">
              <div className="eyebrow"><span className="status-dot" /> Android beta · Open source</div>
              <h1 aria-label="Keep your terminal within reach.">
                <span className="hero-line"><i>Keep your terminal</i></span>
                <span className="hero-line hero-line--accent"><i>within reach.</i></span>
              </h1>
              <p className="hero-lede">{site.description}</p>
              <div className="hero-actions">
                <a className="button button--primary" href="#get-started">Get started <span aria-hidden="true">↓</span></a>
                <a className="button button--ghost" href={site.urls.repository} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
              </div>
              <CommandBlock command={site.command} compact />
              <p className="hero-note">NODE.JS 20+ · MACOS · LINUX · WINDOWS · WSL</p>
            </div>

            <div className="hero-product" data-visible="true">
              <div className="hero-orbit hero-orbit--one" aria-hidden="true" />
              <div className="hero-orbit hero-orbit--two" aria-hidden="true" />
              <div className="hero-terminal" aria-hidden="true">
                <div className="terminal-bar"><span /><span /><span /><em>mobily — studio-workstation</em></div>
                <div className="terminal-lines">
                  <code><b>$</b> npx mobily --tunnel devtunnels</code>
                  <code><i>✓</i> Session <strong>mobily-main</strong> ready</code>
                  <code><i>✓</i> Secure tunnel active</code>
                  <code><span>▦</span> Scan the one-time QR to pair</code>
                </div>
              </div>
              <PhoneFrame
                className="phone-frame--hero"
                src="/product/terminal.webp"
                alt="Mobily connected to a live terminal Session on an Android phone"
                eager
              />
              <div className="connection-badge connection-badge--live"><span className="status-dot" /><div><strong>Session live</strong><small>studio-workstation</small></div></div>
              <div className="connection-badge connection-badge--key"><span>KEY</span><div><strong>Device verified</strong><small>challenge signed</small></div></div>
            </div>
          </div>
          <div className="hero-index" aria-hidden="true"><span>01</span><i /><span>SCROLL TO CONNECT</span></div>
        </section>

        <section className="trust-strip" aria-label="Mobily at a glance">
          <div className="container trust-grid">
            {trustPoints.map((point) => <div className="trust-point" key={point.label}><span>{point.mark}</span><strong>{point.label}</strong></div>)}
          </div>
        </section>

        <section className="manifesto-section">
          <div className="container manifesto-grid" data-reveal>
            <p className="section-kicker">WHEN THE WORK IS STILL RUNNING</p>
            <h2><span>Leave the desk.</span><span>Keep the thread.</span></h2>
            <div className="manifesto-copy">
              <p>Your build is still running. Your agent needs permission. The one command that unblocks everything is sitting across the room.</p>
              <p>Mobily keeps a secure line to the Session already alive on your Station—so distance stops being the reason work stalls.</p>
            </div>
          </div>
        </section>

        <section className="story-section" id="how-it-works">
          <div className="story-intro container" data-reveal>
            <p className="section-kicker">FROM DESK TO POCKET</p>
            <h2>One trust line.<br /><span>Four native moments.</span></h2>
            <p>Start in the terminal. Continue on Android. Nothing gets uploaded to a Mobily service in between.</p>
          </div>
          <div className="container story-layout">
            <div className="story-stage" aria-live="polite">
              <div className="story-stage-grid" aria-hidden="true" />
              <div className="story-stage-label"><span className="status-dot" />{productStory.find((item) => item.id === activeStory)?.status}</div>
              <div className="story-phone-stack">
                <div className="story-phone-glow" aria-hidden="true" />
                {productStory.map((item) => (
                  <div className="story-screen" data-active={item.id === activeStory} key={item.id}>
                    <PhoneFrame src={item.src} alt={item.alt} />
                  </div>
                ))}
              </div>
              <div className="story-progress" aria-label={`Product story step ${productStory.findIndex((item) => item.id === activeStory) + 1} of ${productStory.length}`}>
                {productStory.map((item) => <span data-active={item.id === activeStory} key={item.id} />)}
              </div>
            </div>
            <div className="story-chapters">
              {productStory.map((item) => (
                <article className="story-chapter" data-story-chapter={item.id} data-active={item.id === activeStory} key={item.id}>
                  <div className="story-mobile-visual"><PhoneFrame src={item.src} alt={item.alt} /></div>
                  <div className="story-chapter-meta"><span>{item.number}</span><i /><span>{item.eyebrow}</span></div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="feature-section" id="features">
          <div className="container">
            <div className="section-heading" data-reveal>
              <div><p className="section-kicker">BUILT FOR THE WORK BETWEEN DESKS</p><h2>Full control.<br /><span>Less friction.</span></h2></div>
              <p>Not a shrunken desktop dashboard. Every Mobily surface is shaped around the quick, consequential moments that happen away from your workstation.</p>
            </div>
            <div className="feature-bento">
              {features.map((feature, index) => (
                <article className={`feature-card feature-card--${feature.layout}`} key={feature.title} data-reveal>
                  <div className="feature-card-meta"><span>{feature.eyebrow}</span><span>{feature.metric}</span></div>
                  <FeatureVisual index={index} />
                  <div className="feature-card-copy"><span className="feature-mark">{feature.mark}</span><div><h3>{feature.title}</h3><p>{feature.description}</p></div></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="security-section" id="security">
          <div className="container security-layout">
            <div className="security-copy" data-reveal>
              <p className="section-kicker">SECURE BY OWNERSHIP</p>
              <h2>Your machine.<br />Your phone.<br /><span>Your keys.</span></h2>
              <p>Mobily connects devices you control. It never asks you to hand source code, terminal history, or a private Device Key to a Mobily service.</p>
              <a className="text-link" href={site.urls.security} target="_blank" rel="noreferrer">Read the security documentation <span aria-hidden="true">↗</span></a>
            </div>
            <div className="security-visual" data-reveal>
              <div className="security-route" aria-label="Secure connection from Station through the selected transport to Android">
                {securityFlow.map((node, index) => (
                  <div className="security-node-wrap" key={node.label}>
                    <div className={`security-node security-node--${index + 1}`}><span>{node.mark}</span><div><strong>{node.label}</strong><small>{node.detail}</small></div></div>
                    {index < securityFlow.length - 1 && <div className="security-connector" aria-hidden="true"><i /><b>{index === 0 ? "TLS" : "SIGNED"}</b></div>}
                  </div>
                ))}
              </div>
              <div className="security-proof-list">
                {securityPoints.map((point, index) => (
                  <article key={point.title}><span>0{index + 1}</span><div><h3>{point.title}</h3><p>{point.description}</p></div></article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="setup-section" id="get-started">
          <div className="container setup-stage" data-reveal>
            <div className="setup-grid" aria-hidden="true" />
            <div className="setup-copy">
              <p className="section-kicker">YOUR NEXT SESSION</p>
              <h2>One command.<br /><span>One scan away.</span></h2>
              <p>Start Mobily on your workstation, then install the signed Android beta from GitHub Releases.</p>
            </div>
            <div className="setup-console">
              <div className="setup-console-bar"><span /><span /><span /><em>quick start</em></div>
              <div className="setup-step"><span>01</span><div><strong>Run on your workstation</strong><CommandBlock command={site.command} /></div></div>
              <div className="setup-step"><span>02</span><div><strong>Install on Android</strong><a className="button button--primary button--download" href={site.urls.releases} target="_blank" rel="noreferrer">Download latest APK <span aria-hidden="true">↓</span></a><small>Signed beta builds are published through GitHub Releases.</small></div></div>
              <div className="local-note"><span aria-hidden="true">⌁</span><p><strong>On the same Wi-Fi?</strong> Use <code>{site.localCommand}</code> for account-free access with pinned TLS.</p></div>
            </div>
          </div>
        </section>

        <section className="faq-section" id="faq">
          <div className="container faq-layout">
            <div className="faq-heading" data-reveal><p className="section-kicker">QUESTIONS, ANSWERED</p><h2>The details<br /><span>developers ask.</span></h2><p>Mobily is intentionally small, explicit, and open. The source is there when you want the full story.</p><a className="text-link" href={site.urls.readme} target="_blank" rel="noreferrer">Read the documentation <span aria-hidden="true">↗</span></a></div>
            <div className="faq-list" data-reveal>
              {faqs.map((faq, index) => <details key={faq.question}><summary><span>0{index + 1}</span>{faq.question}<i aria-hidden="true">+</i></summary><p>{faq.answer}</p></details>)}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-main">
          <div><a className="wordmark" href="#top"><Wordmark /></a><p>A secure Android companion for terminal-based development.</p></div>
          <p className="footer-statement">THE SESSION<br />STAYS WITH YOU.</p>
          <div className="footer-links"><a href={site.urls.repository} target="_blank" rel="noreferrer">GitHub</a><a href={site.urls.releases} target="_blank" rel="noreferrer">Releases</a><a href={site.urls.readme} target="_blank" rel="noreferrer">Documentation</a><a href={site.urls.security} target="_blank" rel="noreferrer">Security</a></div>
        </div>
        <div className="container footer-bottom"><span>© {new Date().getFullYear()} Mobily contributors</span><a href={site.urls.license} target="_blank" rel="noreferrer">MIT licensed</a><span>Built in the open.</span></div>
      </footer>
    </>
  );
}
