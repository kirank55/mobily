import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

function windowsHost() {
  try {
    const resolv = readFileSync('/etc/resolv.conf', 'utf8');
    const match = resolv.match(/nameserver\s+(\S+)/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  return '127.0.0.1';
}

const host = process.env.CDP_HOST || windowsHost();
const list = await (await fetch(`http://${host}:9222/json/list`)).json();
const page = list.find((t) => t.title === 'mobily terminal') || list[0];
if (!page?.webSocketDebuggerUrl) throw new Error('no page target');
const wsUrl = page.webSocketDebuggerUrl
  .replace('127.0.0.1', host)
  .replace('localhost', host);
console.log('WS', wsUrl);

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

let nextId = 1;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send('Runtime.enable');
const probe = await send('Runtime.evaluate', {
  expression: `(() => {
    const viewport = document.getElementById('viewport');
    const screen = document.querySelector('.xterm-screen');
    const vr = viewport.getBoundingClientRect();
    const sr = screen ? screen.getBoundingClientRect() : null;
    return {
      hasFocusHelper: document.documentElement.outerHTML.includes('focusTerminalInput'),
      active: document.activeElement && document.activeElement.className,
      viewport: { x: vr.left, y: vr.top, w: vr.width, h: vr.height },
      screen: sr ? { x: sr.left, y: sr.top, w: sr.width, h: sr.height } : null,
    };
  })()`,
  returnByValue: true,
});
console.log('PROBE', JSON.stringify(probe.result.value, null, 2));

const info = probe.result.value;
if (!info.hasFocusHelper) {
  console.error('SHIPPED_HTML_MISSING_focusTerminalInput — reload the app bundle');
  process.exit(2);
}

const x = Math.round(info.viewport.x + info.viewport.w / 2);
const y = Math.round(
  info.screen
    ? Math.min(info.viewport.y + info.viewport.h - 4, info.screen.y + info.screen.h + 8)
    : info.viewport.y + info.viewport.h * 0.5,
);
console.log('TAP', { x, y });

await send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x, y, id: 0 }],
});
await send('Input.dispatchTouchEvent', {
  type: 'touchEnd',
  touchPoints: [],
});
await new Promise((r) => setTimeout(r, 700));

const after = await send('Runtime.evaluate', {
  expression: `({
    active: document.activeElement && document.activeElement.className,
    isTextarea: !!(document.activeElement &&
      document.activeElement.classList.contains('xterm-helper-textarea')),
  })`,
  returnByValue: true,
});
console.log('AFTER', JSON.stringify(after.result.value));
ws.close();
if (!after.result.value.isTextarea) {
  process.exit(1);
}
