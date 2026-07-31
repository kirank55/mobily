/**
 * Issue 02 — Recover scrollback after abrupt alternate-screen TUI exit
 * (`.scratch/android-terminal-rash-bugs/issues/02-recover-scrollback-after-abrupt-tui-exit.md`).
 *
 * An alternate-screen TUI that dies without `\x1b[?1049l` used to leave xterm
 * on the alternate buffer so shell output after `[mobily] ` accumulated no
 * scrollback. prepareOutput now injects a leave sequence at that Mobily
 * process boundary; these cases pin the recovery and the orderly-exit path.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { buildTerminalDocument } from '../../src/terminal/terminalDocument.js';

const workspaceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const terminalHtml = buildTerminalDocument({
  xtermCss: readFileSync(resolve(workspaceRoot, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8'),
  xtermJs: readFileSync(resolve(workspaceRoot, 'node_modules/@xterm/xterm/lib/xterm.js'), 'utf8'),
  xtermFitJs: readFileSync(
    resolve(workspaceRoot, 'node_modules/@xterm/addon-fit/lib/addon-fit.js'),
    'utf8',
  ),
  devBridgeJs: `
    window.__mobilyMessages=[];
    window.__mobilyInspectTerminal=function(terminal){window.__mobilyTerminal=terminal;};
    window.__mobilyTerminalLines=function(){
      var terminal=window.__mobilyTerminal;
      return Array.from({length:terminal.rows},function(_,row){
        return terminal.buffer.active.getLine(terminal.buffer.active.viewportY+row).translateToString(true).trimEnd();
      });
    };
    window.ReactNativeWebView={postMessage:function(raw){
      window.__mobilyMessages.push(JSON.parse(raw));
    }};
  `,
});

const TWO_HUNDRED_LINES = Array.from({ length: 200 }, (_, index) => `line ${index}\r\n`).join('');

async function waitForReady(page) {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);
}

test('Mobily prompt arriving in alternate-screen recovers scrollback after 200 lines', async ({
  page,
}) => {
  await waitForReady(page);

  const result = await page.evaluate(async (lines) => {
    const write = (data) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'write', data }),
        }),
      );
    const settle = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    write('\u001b[?1049h\u001b[2J\u001b[HABRUPT TUI');
    await settle();
    const duringTui = {
      type: window.__mobilyTerminal.buffer.active.type,
      baseY: window.__mobilyTerminal.buffer.active.baseY,
    };

    // Process dies; shell redraws the Mobily prompt without DECRST 1049.
    write('\r\n[mobily] shell$ ');
    await settle();
    const afterPrompt = {
      type: window.__mobilyTerminal.buffer.active.type,
      baseY: window.__mobilyTerminal.buffer.active.baseY,
    };

    write(lines);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const buffer = window.__mobilyTerminal.buffer.active;

    return {
      duringTui,
      afterPrompt,
      after200: {
        type: buffer.type,
        baseY: buffer.baseY,
        viewportY: buffer.viewportY,
      },
      keyRowDisplay: document.getElementById('key-row').style.display,
    };
  }, TWO_HUNDRED_LINES);

  expect(result.duringTui).toEqual({ type: 'alternate', baseY: 0 });
  expect(result.afterPrompt.type).toBe('normal');
  expect(result.after200.type).toBe('normal');
  expect(result.after200.baseY).toBeGreaterThan(0);
  expect(result.keyRowDisplay).toBe('flex');
});

test('vertical history gesture works after abrupt alt-screen exit recovery', async ({ page }) => {
  await waitForReady(page);

  const result = await page.evaluate(async (lines) => {
    const write = (data) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'write', data }),
        }),
      );
    const dispatchTouch = (target, type, touches, changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches });
      target.dispatchEvent(event);
    };
    const settle = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    write('\u001b[?1049h\u001b[2J\u001b[HABRUPT TUI');
    await settle();
    write('\r\n[mobily] shell$ ');
    await settle();
    write(lines);
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.__mobilyTerminal.scrollToBottom();

    const viewport = document.getElementById('viewport');
    const screenRect = document.querySelector('.xterm-screen').getBoundingClientRect();
    const startTouch = {
      clientX: screenRect.left + screenRect.width / 2,
      clientY: screenRect.top + 100,
    };
    const endTouch = {
      clientX: startTouch.clientX,
      clientY: startTouch.clientY + 180,
    };
    const before = window.__mobilyTerminal.buffer.active.viewportY;
    window.__mobilyMessages = [];
    dispatchTouch(viewport, 'touchstart', [startTouch]);
    dispatchTouch(viewport, 'touchmove', [endTouch]);
    dispatchTouch(viewport, 'touchend', [], [endTouch]);

    return {
      type: window.__mobilyTerminal.buffer.active.type,
      baseY: window.__mobilyTerminal.buffer.active.baseY,
      before,
      after: window.__mobilyTerminal.buffer.active.viewportY,
      inputCount: window.__mobilyMessages.filter((message) => message.type === 'input').length,
      keyRowDisplay: document.getElementById('key-row').style.display,
    };
  }, TWO_HUNDRED_LINES);

  expect(result.type).toBe('normal');
  expect(result.baseY).toBeGreaterThan(0);
  expect(result.after).toBeLessThan(result.before);
  expect(result.inputCount).toBe(0);
  expect(result.keyRowDisplay).toBe('flex');
});

test('orderly alternate-screen exit still accumulates scrollback and accepts history swipes', async ({
  page,
}) => {
  await waitForReady(page);

  const result = await page.evaluate(async (lines) => {
    const write = (data) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'write', data }),
        }),
      );
    const dispatchTouch = (target, type, touches, changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches });
      target.dispatchEvent(event);
    };
    const settle = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    write('\u001b[?1049h\u001b[2J\u001b[HORDERLY TUI');
    await settle();
    write('\u001b[?1049l\r\n[mobily] shell$ ');
    await settle();
    write(lines);
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.__mobilyTerminal.scrollToBottom();

    const viewport = document.getElementById('viewport');
    const screenRect = document.querySelector('.xterm-screen').getBoundingClientRect();
    const startTouch = {
      clientX: screenRect.left + screenRect.width / 2,
      clientY: screenRect.top + 100,
    };
    const endTouch = {
      clientX: startTouch.clientX,
      clientY: startTouch.clientY + 180,
    };
    const before = window.__mobilyTerminal.buffer.active.viewportY;
    window.__mobilyMessages = [];
    dispatchTouch(viewport, 'touchstart', [startTouch]);
    dispatchTouch(viewport, 'touchmove', [endTouch]);
    dispatchTouch(viewport, 'touchend', [], [endTouch]);

    return {
      type: window.__mobilyTerminal.buffer.active.type,
      baseY: window.__mobilyTerminal.buffer.active.baseY,
      before,
      after: window.__mobilyTerminal.buffer.active.viewportY,
      inputCount: window.__mobilyMessages.filter((message) => message.type === 'input').length,
      keyRowDisplay: document.getElementById('key-row').style.display,
    };
  }, TWO_HUNDRED_LINES);

  expect(result.type).toBe('normal');
  expect(result.baseY).toBeGreaterThan(0);
  expect(result.after).toBeLessThan(result.before);
  expect(result.inputCount).toBe(0);
  expect(result.keyRowDisplay).toBe('flex');
});
