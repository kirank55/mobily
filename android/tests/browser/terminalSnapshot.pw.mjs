import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { MAX_SESSION_SCROLLBACK_CHARS } from '@mobily/shared';

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

test('re-announces readiness when React Native probes after page load', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  await page.evaluate(() => {
    window.__mobilyMessages = [];
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'ready-probe' }),
      }),
    );
  });

  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);
});

test('focuses the keyboard while sending terminal button taps as mouse input', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const result = await page.evaluate(async () => {
    const dispatchMessage = (message) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify(message),
        }),
      );
    dispatchMessage({ type: 'write', data: '\u001b[?1000;1006h' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    dispatchMessage({ type: 'keyboard', visible: true });
    const focused = document.activeElement?.classList.contains('xterm-helper-textarea') === true;
    dispatchMessage({ type: 'keyboard', visible: false });
    const blurred = document.activeElement?.classList.contains('xterm-helper-textarea') !== true;

    window.__mobilyMessages = [];
    document.querySelector('[data-seq="CTRL_C"]').click();
    const shortcut = window.__mobilyMessages.find((message) => message.type === 'input')?.data;

    window.__mobilyMessages = [];
    window.__mobilyTerminal.focus();
    const viewport = document.getElementById('viewport');
    const screen = document.querySelector('.xterm-screen');
    const rect = screen.getBoundingClientRect();
    const touch = {
      clientX: rect.left + rect.width / window.__mobilyTerminal.cols / 2,
      clientY: rect.top + rect.height / window.__mobilyTerminal.rows / 2,
    };
    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'touches', { value: [touch] });
    Object.defineProperty(start, 'changedTouches', { value: [touch] });
    viewport.dispatchEvent(start);
    const end = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(end, 'touches', { value: [] });
    Object.defineProperty(end, 'changedTouches', { value: [touch] });
    viewport.dispatchEvent(end);
    const click = window.__mobilyMessages.find((message) => message.type === 'input')?.data;

    return {
      focused,
      blurred,
      shortcut,
      click,
      terminalFocused: document.activeElement?.classList.contains('xterm-helper-textarea') === true,
    };
  });

  expect(result).toEqual({
    focused: true,
    blurred: true,
    shortcut: '\u0003',
    click: '\u001b[<0;1;1M\u001b[<0;1;1m',
    terminalFocused: true,
  });
});

test('focuses the keyboard from blank space without turning the tap into a TUI click', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const result = await page.evaluate(async () => {
    const dispatchMessage = (message) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify(message),
        }),
      );
    const dispatchTouch = (target, type, touches, changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };

    dispatchMessage({ type: 'write', data: '\u001b[?1000;1006h' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const viewport = document.getElementById('viewport');
    const screen = document.querySelector('.xterm-screen');
    const viewportRect = viewport.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const blankTouch = {
      clientX: viewportRect.left + viewportRect.width / 2,
      clientY: Math.min(viewportRect.bottom - 2, screenRect.bottom + 8),
    };

    window.__mobilyMessages = [];
    // The keyboard opens only once the tap resolves on touchend, and the
    // gesture must stay uncancelled so the soft keyboard can open.
    const startPrevented = dispatchTouch(viewport, 'touchstart', [blankTouch]);
    const focusedOnStart =
      document.activeElement?.classList.contains('xterm-helper-textarea') === true;
    const endPrevented = dispatchTouch(viewport, 'touchend', [], [blankTouch]);

    return {
      focusedOnStart,
      focused: document.activeElement?.classList.contains('xterm-helper-textarea') === true,
      startPrevented,
      endPrevented,
      inputCount: window.__mobilyMessages.filter((message) => message.type === 'input').length,
    };
  });

  expect(result).toEqual({
    focusedOnStart: false,
    focused: true,
    startPrevented: false,
    endPrevented: false,
    inputCount: 0,
  });
});

test('scrolls terminal history with a vertical swipe while mouse reporting is active', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const result = await page.evaluate(async () => {
    const dispatchMessage = (message) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify(message),
        }),
      );
    const dispatchTouch = (target, type, touches, changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches });
      target.dispatchEvent(event);
    };

    dispatchMessage({
      type: 'write',
      data: Array.from({ length: 120 }, (_, index) => `history ${index}\r\n`).join(''),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.__mobilyTerminal.scrollToBottom();
    dispatchMessage({ type: 'write', data: '\u001b[?1000;1006h' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

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
      before,
      after: window.__mobilyTerminal.buffer.active.viewportY,
      inputCount: window.__mobilyMessages.filter((message) => message.type === 'input').length,
    };
  });

  expect(result.after).toBeLessThan(result.before);
  expect(result.inputCount).toBe(0);
});

test('scrolls a mouse-enabled alternate-screen TUI with a vertical swipe', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const result = await page.evaluate(async () => {
    const dispatchMessage = (data) =>
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

    dispatchMessage('\u001b[?1000;1006;1049h');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

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

    window.__mobilyMessages = [];
    dispatchTouch(viewport, 'touchstart', [startTouch]);
    dispatchTouch(viewport, 'touchmove', [endTouch]);
    dispatchTouch(viewport, 'touchend', [], [endTouch]);

    return window.__mobilyMessages
      .filter((message) => message.type === 'input')
      .map((message) => message.data);
  });

  expect(result.some((data) => /^(?:\u001b\[<64;\d+;\d+M)+$/.test(data))).toBe(true);
});

test('opens the keyboard on tap resolution and keeps it closed for swipes and pans', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const result = await page.evaluate(async () => {
    const dispatchMessage = (message) =>
      window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    const dispatchTouch = (type, touches, changedTouches = touches) => {
      const viewport = document.getElementById('viewport');
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches });
      viewport.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const keyboardFocused = () =>
      document.activeElement?.classList.contains('xterm-helper-textarea') === true;
    const nextFrame = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    dispatchMessage({
      type: 'write',
      data: Array.from({ length: 120 }, (_, index) => `history ${index}\r\n`).join(''),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.__mobilyTerminal.scrollToBottom();

    const screenRect = document.querySelector('.xterm-screen').getBoundingClientRect();
    const tapPoint = { clientX: screenRect.left + 20, clientY: screenRect.top + 20 };

    // 1. Plain tap: the keyboard opens when the tap resolves, not on touchdown.
    const tapStartPrevented = dispatchTouch('touchstart', [tapPoint]);
    const focusedOnTapStart = keyboardFocused();
    dispatchTouch('touchend', [], [tapPoint]);
    const focusedAfterTap = keyboardFocused();

    // 2. History swipe: the keyboard stays closed through the whole gesture.
    dispatchMessage({ type: 'keyboard', visible: false });
    const swipeStart = { clientX: screenRect.left + 20, clientY: screenRect.top + 100 };
    const swipeEnd = { clientX: swipeStart.clientX, clientY: swipeStart.clientY + 180 };
    const viewportBefore = window.__mobilyTerminal.buffer.active.viewportY;
    dispatchTouch('touchstart', [swipeStart]);
    const focusedOnSwipeStart = keyboardFocused();
    dispatchTouch('touchmove', [swipeEnd]);
    dispatchTouch('touchend', [], [swipeEnd]);
    const focusedAfterSwipe = keyboardFocused();
    const swipedThroughHistory =
      window.__mobilyTerminal.buffer.active.viewportY < viewportBefore;

    // 3. Zoomed-in still tap: touchdown stays uncancelled and the keyboard
    // opens on release.
    dispatchMessage({ type: 'zoom', delta: 2 });
    await nextFrame();
    const zoomTapStartPrevented = dispatchTouch('touchstart', [tapPoint]);
    dispatchTouch('touchend', [], [tapPoint]);
    const focusedAfterZoomTap = keyboardFocused();

    // 4. Zoomed-in pan: the keyboard stays closed.
    dispatchMessage({ type: 'keyboard', visible: false });
    const panStart = { clientX: 300, clientY: 250 };
    const panEnd = { clientX: 80, clientY: 80 };
    dispatchTouch('touchstart', [panStart]);
    dispatchTouch('touchmove', [panEnd]);
    dispatchTouch('touchend', [], [panEnd]);
    const focusedAfterPan = keyboardFocused();

    return {
      tapStartPrevented,
      focusedOnTapStart,
      focusedAfterTap,
      focusedOnSwipeStart,
      focusedAfterSwipe,
      swipedThroughHistory,
      zoomTapStartPrevented,
      focusedAfterZoomTap,
      focusedAfterPan,
    };
  });

  expect(result).toEqual({
    tapStartPrevented: false,
    focusedOnTapStart: false,
    focusedAfterTap: true,
    focusedOnSwipeStart: false,
    focusedAfterSwipe: false,
    swipedThroughHistory: true,
    zoomTapStartPrevented: false,
    focusedAfterZoomTap: true,
    focusedAfterPan: false,
  });
});

test('returns taps to keyboard focus after a mouse-enabled TUI exits', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const result = await page.evaluate(async () => {
    const dispatchMessage = (data) =>
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

    dispatchMessage('\u001b[?1000;1006;1049h');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    dispatchMessage('\u001b[?1049l\r\n[mobily] shell$ ');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const viewport = document.getElementById('viewport');
    const screenRect = document.querySelector('.xterm-screen').getBoundingClientRect();
    const touch = {
      clientX: screenRect.left + 20,
      clientY: screenRect.top + 20,
    };
    window.__mobilyMessages = [];
    dispatchTouch(viewport, 'touchstart', [touch]);
    dispatchTouch(viewport, 'touchend', [], [touch]);

    return {
      focused: document.activeElement?.classList.contains('xterm-helper-textarea') === true,
      inputCount: window.__mobilyMessages.filter((message) => message.type === 'input').length,
    };
  });

  expect(result).toEqual({ focused: true, inputCount: 0 });
});

test('pans the terminal horizontally with one finger after zooming in', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const result = await page.evaluate(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'zoom', delta: 2 }),
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'write', data: '\u001b[?1000;1006h' }),
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const viewport = document.getElementById('viewport');
    window.__mobilyMessages = [];
    const startTouch = { clientX: 300, clientY: 250 };
    const endTouch = { clientX: 80, clientY: 80 };
    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'touches', { value: [startTouch] });
    Object.defineProperty(start, 'changedTouches', { value: [startTouch] });
    viewport.dispatchEvent(start);

    const move = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(move, 'touches', { value: [endTouch] });
    Object.defineProperty(move, 'changedTouches', { value: [endTouch] });
    viewport.dispatchEvent(move);

    const end = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(end, 'touches', { value: [] });
    Object.defineProperty(end, 'changedTouches', { value: [endTouch] });
    viewport.dispatchEvent(end);

    return {
      hasHorizontalOverflow: viewport.scrollWidth > viewport.clientWidth,
      hasVerticalOverflow: viewport.scrollHeight > viewport.clientHeight,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      inputCount: window.__mobilyMessages.filter((message) => message.type === 'input').length,
    };
  });

  expect(result.hasHorizontalOverflow).toBe(true);
  expect(result.hasVerticalOverflow).toBe(true);
  expect(result.scrollLeft).toBeGreaterThan(0);
  expect(result.scrollTop).toBeGreaterThan(0);
  expect(result.inputCount).toBe(0);
});

test('renders a detailed OpenCode-like Session Snapshot in the production document', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const snapshot = openCodeSnapshot();
  await page.evaluate((nextSnapshot) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session-snapshot', snapshot: nextSnapshot }),
      }),
    );
  }, snapshot);

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
      ),
    )
    .toBe(true);

  const rendered = await page.evaluate(() => {
    const terminal = window.__mobilyTerminal;
    const titleCell = terminal.buffer.active.getLine(0).getCell(1);
    const modelCell = terminal.buffer.active.getLine(2).getCell(9);
    const wideCell = terminal.buffer.active.getLine(4).getCell(7);
    return {
      cols: terminal.cols,
      rows: terminal.rows,
      activeScreen: terminal.buffer.active.type,
      lines: Array.from({ length: terminal.rows }, (_, row) =>
        terminal.buffer.active.getLine(row).translateToString(true).trimEnd(),
      ),
      titleCell: {
        chars: titleCell.getChars(),
        bold: Boolean(titleCell.isBold()),
        fg: titleCell.getFgColor(),
        bg: titleCell.getBgColor(),
      },
      modelCell: {
        chars: modelCell.getChars(),
        italic: Boolean(modelCell.isItalic()),
        underline: Boolean(modelCell.isUnderline()),
      },
      wideCell: {
        chars: wideCell.getChars(),
        width: wideCell.getWidth(),
      },
      cursor: {
        col: terminal.buffer.active.cursorX,
        row: terminal.buffer.active.cursorY,
        style: terminal.options.cursorStyle,
        blink: terminal.options.cursorBlink,
      },
    };
  });

  expect(rendered).toEqual({
    cols: 40,
    rows: 8,
    activeScreen: 'alternate',
    lines: [
      ' OpenCode',
      '┌─ workspace ───────────────────────┐',
      '│ model: GPT-5',
      '│ ✓ READY redraw',
      '│ plan 界 step',
      '╰─› implement issue 2',
      '',
      '',
    ],
    titleCell: {
      chars: 'O',
      bold: true,
      fg: 0x12abef,
      bg: 17,
    },
    modelCell: {
      chars: 'G',
      italic: true,
      underline: true,
    },
    wideCell: {
      chars: '界',
      width: 2,
    },
    cursor: { col: 4, row: 6, style: 'bar', blink: false },
  });

  await page.evaluate(() => {
    window.__mobilyTerminal.write('\u001b[?25$p');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'write', data: '\u001b[?1002;1049l' }),
      }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminal.buffer.active.type))
    .toBe('normal');
  expect(
    await page.evaluate(() =>
      window.__mobilyMessages.some(
        (message) => message.type === 'input' && message.data === '\u001b[?25;2$y',
      ),
    ),
  ).toBe(true);
});

test('retains the old frame while reconnecting and atomically replaces it before live output', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  await dispatchSnapshot(page, textSnapshot('OLD FRAME'));
  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminalLines().join('\n')))
    .toContain('OLD FRAME');

  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'connection-state',
          state: 'reconnecting',
          detail: 'attempt 1',
        }),
      }),
    );
  });

  await expect(page.locator('#connection-overlay')).toContainText('Reconnecting');
  await expect(page.locator('#connection-overlay')).toHaveAttribute('data-state', 'reconnecting');
  expect(await page.evaluate(() => window.__mobilyTerminalLines().join('\n'))).toContain(
    'OLD FRAME',
  );

  await page.evaluate((nextSnapshot) => {
    window.__mobilyMessages = [];
    window.__observedTerminalFrames = [];
    const sample = () => {
      window.__observedTerminalFrames.push(window.__mobilyTerminalLines().join('\n'));
    };
    sample();
    requestAnimationFrame(sample);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session-snapshot', snapshot: nextSnapshot }),
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'write', data: '\r\nLIVE ONCE' }),
      }),
    );
    requestAnimationFrame(() => requestAnimationFrame(sample));
  }, textSnapshot('FRESH FRAME'));

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'connection-state', state: 'live' }),
      }),
    );
  });
  await expect(page.locator('#connection-overlay')).toHaveAttribute('data-state', 'live');
  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminalLines().join('\n')))
    .toContain('LIVE ONCE');

  const result = await page.evaluate(() => ({
    rendered: window.__mobilyTerminalLines().join('\n'),
    observed: window.__observedTerminalFrames,
  }));
  expect(result.rendered).toContain('FRESH FRAME');
  expect(result.rendered.match(/LIVE ONCE/g)).toHaveLength(1);
  for (const frame of result.observed) {
    expect(frame.includes('OLD FRAME') && frame.includes('FRESH FRAME')).toBe(false);
  }
});

test('does not let a stale snapshot completion hide a newer reconnect state', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);
  await dispatchSnapshot(page, textSnapshot('OLD FRAME'));

  await page.evaluate((nextSnapshot) => {
    window.__mobilyMessages = [];
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session-snapshot', snapshot: nextSnapshot }),
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'connection-state',
          state: 'reconnecting',
          detail: 'attempt 2',
        }),
      }),
    );
  }, textSnapshot('FRESH FRAME'));

  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
      ),
  );
  expect(
    await page.evaluate(() =>
      window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
    ),
  ).toBe(false);
  await expect(page.locator('#connection-overlay')).toHaveAttribute('data-state', 'reconnecting');
  await expect(page.locator('#connection-overlay')).toContainText('attempt 2');
  expect(await page.evaluate(() => window.__mobilyTerminalLines().join('\n'))).toContain(
    'OLD FRAME',
  );
});

test('keeps the first paint visible while maximum scrollback starts loading', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const snapshot = textSnapshot('CURRENT SCREEN');
  await dispatchSnapshot(page, snapshot);
  expect(await page.evaluate(() => window.__mobilyTerminalLines().join('\n'))).toContain(
    'CURRENT SCREEN',
  );

  const visibleHistory = `${'bounded history\r\n'.repeat(100)}FINAL HISTORY\r\n`;
  const history =
    '\0'.repeat(MAX_SESSION_SCROLLBACK_CHARS - visibleHistory.length) + visibleHistory;
  expect(history).toHaveLength(MAX_SESSION_SCROLLBACK_CHARS);
  await page.evaluate(
    ({ data, currentSnapshot }) => {
      window.__mobilyMessages = [];
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'session-scrollback',
            data,
            snapshot: currentSnapshot,
            liveOutput: '',
          }),
        }),
      );
    },
    { data: history, currentSnapshot: snapshot },
  );

  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminalLines().join('\n')))
    .toContain('CURRENT SCREEN');
  expect(await page.evaluate(() => window.__mobilyTerminal.buffer.active.baseY)).toBeGreaterThan(0);
});

test('does not emit stale mouse packets when connection scrollback restores a shell', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const snapshot = textSnapshot('[mobily] shell$');
  await dispatchSnapshot(page, snapshot);
  await page.evaluate((currentSnapshot) => {
    window.__mobilyMessages = [];
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'session-scrollback',
          data:
            '\u001b[?1003;1006hprevious TUI output\r\n' +
            'history while TUI was active\r\n'.repeat(20),
          snapshot: currentSnapshot,
          liveOutput: '',
        }),
      }),
    );
  }, snapshot);
  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminal.buffer.active.baseY))
    .toBeGreaterThan(0);

  const screen = await page.locator('.xterm-screen').boundingBox();
  expect(screen).not.toBeNull();
  await page.evaluate(() => {
    window.__mobilyMessages = [];
  });
  await page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  const input = await page.evaluate(() =>
    window.__mobilyMessages
      .filter((message) => message.type === 'input')
      .map((message) => message.data),
  );
  expect(input).toEqual([]);
});

test('restores TUI swipe scrolling when connection scrollback contains mouse mode', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const snapshot = openCodeSnapshot();
  await dispatchSnapshot(page, snapshot);
  await page.evaluate((currentSnapshot) => {
    window.__beforeScrollbackTerminal = window.__mobilyTerminal;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'session-scrollback',
          data:
            '\u001b[?1000;1006hprevious TUI output\r\n' +
            'history while TUI was active\r\n'.repeat(20),
          snapshot: currentSnapshot,
          liveOutput: '',
        }),
      }),
    );
  }, snapshot);
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyTerminal !== window.__beforeScrollbackTerminal),
    )
    .toBe(true);

  const result = await page.evaluate(() => {
    const dispatchTouch = (target, type, touches, changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches });
      target.dispatchEvent(event);
    };
    const viewport = document.getElementById('viewport');
    const screenRect = document.querySelector('.xterm-screen').getBoundingClientRect();
    const startTouch = {
      clientX: screenRect.left + screenRect.width / 2,
      clientY: screenRect.top + 40,
    };
    const endTouch = {
      clientX: startTouch.clientX,
      clientY: startTouch.clientY + 100,
    };

    window.__mobilyMessages = [];
    dispatchTouch(viewport, 'touchstart', [startTouch]);
    dispatchTouch(viewport, 'touchmove', [endTouch]);
    dispatchTouch(viewport, 'touchend', [], [endTouch]);

    return window.__mobilyMessages
      .filter((message) => message.type === 'input')
      .map((message) => message.data);
  });

  expect(result.some((data) => /^(?:\u001b\[<64;\d+;\d+M)+$/.test(data))).toBe(true);
});

test('does not duplicate live output queued when scrollback rebuild begins', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);
  const snapshot = textSnapshot('CURRENT SCREEN');
  await dispatchSnapshot(page, snapshot);

  await page.evaluate((currentSnapshot) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'write', data: '\r\nLIVE ONCE' }),
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'session-scrollback',
          data: 'older output\r\n',
          snapshot: currentSnapshot,
          liveOutput: '\r\nLIVE ONCE',
        }),
      }),
    );
  }, snapshot);

  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminalLines().join('\n')))
    .toContain('LIVE ONCE');
  const rendered = await page.evaluate(() => window.__mobilyTerminalLines().join('\n'));
  expect(rendered.match(/LIVE ONCE/g)).toHaveLength(1);
});

async function dispatchSnapshot(page, snapshot) {
  await page.evaluate((nextSnapshot) => {
    window.__mobilyMessages = [];
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session-snapshot', snapshot: nextSnapshot }),
      }),
    );
  }, snapshot);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
      ),
    )
    .toBe(true);
}

function textSnapshot(text) {
  const cols = 20;
  const rows = 3;
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ chars: ' ', width: 1 })),
  );
  writeRow(grid[0], text);
  return {
    type: 'session-snapshot',
    cols,
    rows,
    activeScreen: 'normal',
    cursor: { col: 0, row: 1, visible: true, style: 'block', blink: false },
    grid,
  };
}

function openCodeSnapshot() {
  const cols = 40;
  const rows = 8;
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ chars: ' ', width: 1 })),
  );
  writeRow(grid[0], ' OpenCode ', {
    fg: { mode: 'rgb', value: 0x12abef },
    bg: { mode: 'palette', value: 17 },
    attrs: 1,
  });
  writeRow(grid[1], '┌─ workspace ───────────────────────┐');
  writeRow(grid[2], '│ model: ');
  writeRow(grid[2], 'GPT-5', { attrs: 12 }, 9);
  writeRow(grid[3], '│ ✓ READY redraw', { fg: { mode: 'palette', value: 3 } });
  writeRow(grid[4], '│ plan ');
  writeRow(grid[4], '界', {}, 7);
  writeRow(grid[4], ' step', {}, 9);
  writeRow(grid[5], '╰─› implement issue 2');
  return {
    type: 'session-snapshot',
    cols,
    rows,
    activeScreen: 'alternate',
    cursor: { col: 4, row: 6, visible: false, style: 'bar', blink: false },
    grid,
  };
}

test('fits a desktop Session into the phone viewport without claiming size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const desktop = openCodeSnapshotForGrid(120, 40);
  await page.evaluate(() => {
    window.__mobilyMessages = [];
  });
  await dispatchSnapshot(page, desktop);

  const fitted = await page.evaluate(() => {
    const tc = document.getElementById('tc');
    const viewport = document.getElementById('viewport');
    const transform = tc.style.transform || '';
    const scaleMatch = /scale\(([^)]+)\)/.exec(transform);
    const scale = scaleMatch ? Number.parseFloat(scaleMatch[1]) : 1;
    const width = Number.parseFloat(tc.style.width) || tc.offsetWidth;
    const height = Number.parseFloat(tc.style.height) || tc.offsetHeight;
    return {
      cols: window.__mobilyTerminal.cols,
      rows: window.__mobilyTerminal.rows,
      scale,
      fittedWidth: width * scale,
      fittedHeight: height * scale,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      resizeCount: window.__mobilyMessages.filter((message) => message.type === 'resize').length,
      firstLine: window.__mobilyTerminalLines()[0],
    };
  });

  expect(fitted.cols).toBe(120);
  expect(fitted.rows).toBe(40);
  expect(fitted.resizeCount).toBe(0);
  expect(fitted.scale).toBeLessThan(1);
  expect(fitted.fittedWidth).toBeLessThanOrEqual(fitted.viewportWidth + 1);
  expect(fitted.fittedHeight).toBeLessThanOrEqual(fitted.viewportHeight + 1);
  expect(fitted.firstLine).toContain('OpenCode');

  await page.evaluate(() => {
    window.__mobilyMessages = [];
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'fit' }),
      }),
    );
  });
  await page.waitForTimeout(100);
  const afterFit = await page.evaluate(() => {
    const tc = document.getElementById('tc');
    const transform = tc.style.transform || '';
    const scaleMatch = /scale\(([^)]+)\)/.exec(transform);
    return {
      scale: scaleMatch ? Number.parseFloat(scaleMatch[1]) : 1,
      resizeCount: window.__mobilyMessages.filter((message) => message.type === 'resize').length,
    };
  });
  expect(afterFit.scale).toBeLessThan(1);
  expect(afterFit.resizeCount).toBe(0);

  const beforeZoom = afterFit.scale;
  await page.evaluate(() => {
    window.__mobilyMessages = [];
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'zoom', delta: 0.5 }),
      }),
    );
  });
  await page.waitForTimeout(100);
  const afterZoom = await page.evaluate(() => {
    const tc = document.getElementById('tc');
    const viewport = document.getElementById('viewport');
    const transform = tc.style.transform || '';
    const scaleMatch = /scale\(([^)]+)\)/.exec(transform);
    return {
      cols: window.__mobilyTerminal.cols,
      rows: window.__mobilyTerminal.rows,
      scale: scaleMatch ? Number.parseFloat(scaleMatch[1]) : 1,
      stageWidth: Number.parseFloat(document.getElementById('stage').style.width),
      viewportWidth: viewport.clientWidth,
      resizeCount: window.__mobilyMessages.filter((message) => message.type === 'resize').length,
    };
  });
  expect(afterZoom.cols).toBe(120);
  expect(afterZoom.rows).toBe(40);
  expect(afterZoom.scale).toBeGreaterThan(beforeZoom);
  expect(afterZoom.resizeCount).toBe(0);
  expect(afterZoom.stageWidth).toBeGreaterThan(afterZoom.viewportWidth);
});

test('fits the complete grid when xterm reports a stale narrow screen width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    const original = descriptor.get;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        const width = original.call(this);
        return this.classList?.contains('xterm-screen') ? width * 0.75 : width;
      },
    });
  });

  await dispatchSnapshot(page, openCodeSnapshotForGrid(200, 60));

  const bounds = await page.evaluate(() => {
    const viewportRect = document.getElementById('viewport').getBoundingClientRect();
    const screenRect = document.querySelector('.xterm-screen').getBoundingClientRect();
    return {
      viewportLeft: viewportRect.left,
      viewportRight: viewportRect.right,
      screenLeft: screenRect.left,
      screenRight: screenRect.right,
    };
  });

  expect(bounds.screenLeft).toBeGreaterThanOrEqual(bounds.viewportLeft - 1);
  expect(bounds.screenRight).toBeLessThanOrEqual(bounds.viewportRight + 1);
});

test('keeps Fit mode fully visible when the Station grid grows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  await dispatchSnapshot(page, openCodeSnapshotForGrid(80, 30));
  const initial = await readTerminalFit(page);
  expect(initial.fittedWidth).toBeLessThanOrEqual(initial.viewportWidth + 1);
  expect(initial.fittedHeight).toBeLessThanOrEqual(initial.viewportHeight + 1);

  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'resize', cols: 200, rows: 60 }),
      }),
    );
  });
  await expect.poll(() => page.evaluate(() => window.__mobilyTerminal.cols)).toBe(200);

  const resized = await readTerminalFit(page);
  expect(resized.fittedWidth).toBeLessThanOrEqual(resized.viewportWidth + 1);
  expect(resized.fittedHeight).toBeLessThanOrEqual(resized.viewportHeight + 1);
  expect(resized.scrollLeft).toBe(0);
  expect(resized.scrollTop).toBe(0);
});

test('fits the initial grid and preserves scale and pan after viewport and snapshot changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  await dispatchSnapshot(page, openCodeSnapshotForGrid(400, 50));
  const fitted = await readTerminalFit(page);
  expect(fitted.scale).toBeLessThan(0.2);
  expect(fitted.fittedWidth).toBeLessThanOrEqual(fitted.viewportWidth + 1);
  expect(fitted.fittedHeight).toBeLessThanOrEqual(fitted.viewportHeight + 1);

  const zoomed = await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'zoom', delta: 1 }),
      }),
    );
    const viewport = document.getElementById('viewport');
    viewport.scrollLeft = 100;
    viewport.scrollTop = 100;
    const tc = document.getElementById('tc');
    const scaleMatch = /scale\(([^)]+)\)/.exec(tc.style.transform || '');
    return {
      scale: scaleMatch ? Number.parseFloat(scaleMatch[1]) : 1,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  });
  await page.setViewportSize({ width: 390, height: 480 });
  await expect.poll(async () => (await readTerminalFit(page)).viewportHeight).toBeLessThan(720);

  const resized = await readTerminalFit(page);
  expect(resized.scale).toBeCloseTo(zoomed.scale, 5);
  expect(resized.scrollLeft).toBe(zoomed.scrollLeft);
  expect(resized.scrollTop).toBe(zoomed.scrollTop);

  await dispatchSnapshot(page, openCodeSnapshotForGrid(300, 40));

  const snapshotPreserved = await readTerminalFit(page);
  expect(snapshotPreserved.scale).toBeCloseTo(zoomed.scale, 5);
  expect(snapshotPreserved.scrollLeft).toBe(zoomed.scrollLeft);
  expect(snapshotPreserved.scrollTop).toBe(zoomed.scrollTop);
});

test('keeps the focused cursor visible when the keyboard shortens the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const snapshot = openCodeSnapshotForGrid(40, 60);
  snapshot.cursor = { col: 4, row: 59, visible: true, style: 'bar', blink: false };
  await dispatchSnapshot(page, snapshot);
  const before = await readTerminalFit(page);

  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'keyboard', visible: true }),
      }),
    );
  });
  await page.setViewportSize({ width: 390, height: 400 });
  await expect.poll(async () => (await readTerminalFit(page)).viewportHeight).toBeLessThan(720);
  await expect.poll(async () => (await readTerminalFit(page)).scrollTop).toBeGreaterThan(0);

  const after = await page.evaluate(() => {
    const terminal = window.__mobilyTerminal;
    const viewport = document.getElementById('viewport');
    const viewportRect = viewport.getBoundingClientRect();
    const screenRect = document.querySelector('.xterm-screen').getBoundingClientRect();
    const cursorBottom =
      screenRect.top +
      ((terminal.buffer.active.cursorY + 1) * screenRect.height) / terminal.rows;
    const scaleMatch = /scale\(([^)]+)\)/.exec(document.getElementById('tc').style.transform || '');
    return {
      rows: terminal.rows,
      scale: scaleMatch ? Number.parseFloat(scaleMatch[1]) : 1,
      scrollTop: viewport.scrollTop,
      cursorBottom,
      viewportBottom: viewportRect.bottom,
    };
  });

  expect(after.rows).toBe(60);
  expect(after.scale).toBeCloseTo(before.scale, 5);
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.cursorBottom).toBeLessThanOrEqual(after.viewportBottom - 2);
});

function openCodeSnapshotForGrid(cols, rows) {
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ chars: ' ', width: 1 })),
  );
  writeRow(grid[0], ' OpenCode ', {
    fg: { mode: 'rgb', value: 0x12abef },
    bg: { mode: 'palette', value: 17 },
    attrs: 1,
  });
  writeRow(grid[1], '┌─ workspace ───────────────────────┐');
  writeRow(grid[2], '│ model: GPT-5');
  writeRow(grid[3], '│ ✓ READY redraw');
  writeRow(grid[4], '│ plan 界 step');
  writeRow(grid[5], '╰─› implement issue 6');
  return {
    type: 'session-snapshot',
    cols,
    rows,
    activeScreen: 'alternate',
    cursor: { col: 4, row: Math.min(6, rows - 1), visible: false, style: 'bar', blink: false },
    grid,
  };
}

async function readTerminalFit(page) {
  return page.evaluate(() => {
    const tc = document.getElementById('tc');
    const viewport = document.getElementById('viewport');
    const scaleMatch = /scale\(([^)]+)\)/.exec(tc.style.transform || '');
    const scale = scaleMatch ? Number.parseFloat(scaleMatch[1]) : 1;
    const width = Number.parseFloat(tc.style.width) || tc.offsetWidth;
    const height = Number.parseFloat(tc.style.height) || tc.offsetHeight;
    return {
      scale,
      fittedWidth: width * scale,
      fittedHeight: height * scale,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  });
}

function writeRow(row, text, style = {}, start = 0) {
  let column = start;
  for (const chars of text) {
    const width = chars === '界' ? 2 : 1;
    if (column >= row.length) break;
    row[column] = { chars, width, ...style };
    if (width === 2 && column + 1 < row.length) row[column + 1] = { chars: '', width: 0, ...style };
    column += width;
  }
}
