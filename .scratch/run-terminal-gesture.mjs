import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildTerminalDocument } from '../android/src/terminal/terminalDocument.js';

const workspaceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
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
    window.ReactNativeWebView={postMessage:function(raw){window.__mobilyMessages.push(JSON.parse(raw));}};
  `,
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 720 } });
await page.setContent(terminalHtml, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mobilyMessages.some((message) => message.type === 'ready'));

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

  const tapStartPrevented = dispatchTouch('touchstart', [tapPoint]);
  const focusedOnTapStart = keyboardFocused();
  dispatchTouch('touchend', [], [tapPoint]);
  const focusedAfterTap = keyboardFocused();

  dispatchMessage({ type: 'keyboard', visible: false });
  const swipeStart = { clientX: screenRect.left + 20, clientY: screenRect.top + 100 };
  const swipeEnd = { clientX: swipeStart.clientX, clientY: swipeStart.clientY + 180 };
  const viewportBefore = window.__mobilyTerminal.buffer.active.viewportY;
  dispatchTouch('touchstart', [swipeStart]);
  const focusedOnSwipeStart = keyboardFocused();
  dispatchTouch('touchmove', [swipeEnd]);
  dispatchTouch('touchend', [], [swipeEnd]);
  const focusedAfterSwipe = keyboardFocused();
  const swipedThroughHistory = window.__mobilyTerminal.buffer.active.viewportY < viewportBefore;

  dispatchMessage({ type: 'zoom', delta: 2 });
  await nextFrame();
  const zoomTapStartPrevented = dispatchTouch('touchstart', [tapPoint]);
  dispatchTouch('touchend', [], [tapPoint]);
  const focusedAfterZoomTap = keyboardFocused();

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

const expected = {
  tapStartPrevented: false,
  focusedOnTapStart: false,
  focusedAfterTap: true,
  focusedOnSwipeStart: false,
  focusedAfterSwipe: false,
  swipedThroughHistory: true,
  zoomTapStartPrevented: false,
  focusedAfterZoomTap: true,
  focusedAfterPan: false,
};

console.log(JSON.stringify({ result, expected }, null, 2));
await browser.close();
if (JSON.stringify(result) !== JSON.stringify(expected)) process.exit(1);
