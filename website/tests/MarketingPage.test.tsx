import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MarketingPage, copyText, getMenuFocusWrapTarget } from "@/components/MarketingPage";
import { productStory, site } from "@/content";

describe("copyText", () => {
  it("uses the Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyText(site.command, { writeText }, null)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(site.command);
  });

  it("falls back to a temporary textarea", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const field = {
      value: "",
      style: { position: "", opacity: "" },
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    const doc = {
      createElement: vi.fn().mockReturnValue(field),
      body: { appendChild: vi.fn() },
      execCommand,
    } as unknown as Document;
    await expect(copyText(site.command, undefined, doc)).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(field.remove).toHaveBeenCalled();
  });

  it("uses the fallback when Clipboard API access is rejected", async () => {
    const field = {
      value: "",
      style: { position: "", opacity: "" },
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    const execCommand = vi.fn().mockReturnValue(true);
    const doc = {
      createElement: vi.fn().mockReturnValue(field),
      body: { appendChild: vi.fn() },
      execCommand,
    } as unknown as Document;
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("Denied")) };
    await expect(copyText(site.command, clipboard, doc)).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when no copy surface exists", async () => {
    await expect(copyText(site.command, null, null)).resolves.toBe(false);
  });
});

describe("MarketingPage", () => {
  it("renders the conversion path and required sections", () => {
    const markup = renderToStaticMarkup(<MarketingPage />);
    expect(markup).toContain("Keep your terminal");
    expect(markup).toContain('id="features"');
    expect(markup).toContain('id="how-it-works"');
    expect(markup).toContain('id="security"');
    expect(markup).toContain('id="get-started"');
    expect(markup).toContain('id="faq"');
    expect(markup).toContain(`href="${site.urls.releases}"`);
  });

  it("ships an accessible initial mobile-menu state", () => {
    const markup = renderToStaticMarkup(<MarketingPage />);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="mobile-menu"');
    expect(markup).toContain('id="mobile-menu"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("hidden");
  });

  it("keeps every authentic product-story chapter in the initial document", () => {
    const markup = renderToStaticMarkup(<MarketingPage />);
    for (const chapter of productStory) {
      expect(markup).toContain(`data-story-chapter="${chapter.id}"`);
      expect(markup).toContain(chapter.title);
      expect(markup).toContain(`alt="${chapter.alt.replaceAll("'", "&#x27;")}"`);
    }
  });

  it("renders command controls with live feedback and the exact CLI command", () => {
    const markup = renderToStaticMarkup(<MarketingPage />);
    expect(markup).toContain(site.command);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Copy");
  });

  it("keeps motion optional in the stylesheet", async () => {
    const css = await readFile(resolve("app/globals.css"), "utf8");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("scroll-behavior: auto !important");
  });
});

describe("getMenuFocusWrapTarget", () => {
  const first = { focus: vi.fn() } as unknown as HTMLElement;
  const middle = { focus: vi.fn() } as unknown as HTMLElement;
  const last = { focus: vi.fn() } as unknown as HTMLElement;
  const focusable = [first, middle, last];

  it("wraps forward from the last item to the first", () => {
    expect(getMenuFocusWrapTarget({ key: "Tab", shiftKey: false }, last, focusable)).toBe(first);
  });

  it("wraps backward from the first item to the last", () => {
    expect(getMenuFocusWrapTarget({ key: "Tab", shiftKey: true }, first, focusable)).toBe(last);
  });

  it("does not interfere with focus inside the menu", () => {
    expect(getMenuFocusWrapTarget({ key: "Tab", shiftKey: false }, middle, focusable)).toBeNull();
    expect(getMenuFocusWrapTarget({ key: "Escape", shiftKey: false }, last, focusable)).toBeNull();
  });
});
