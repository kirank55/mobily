# Mobile terminal browser debugging

`terminalSnapshot.pw.mjs` runs the production xterm WebView document in
headless Chromium at a phone-sized viewport. Use it as the first feedback loop
for Android terminal rendering, touch, keyboard, selection, zoom, pan, and
mouse-reporting bugs. It is faster and more deterministic than rebuilding an
APK or driving a physical device.

The harness calls `buildTerminalDocument()` from
`android/src/terminal/terminalDocument.js` with the production xterm CSS,
xterm JavaScript, and fit addon. Its development bridge exposes:

- `window.__mobilyTerminal`: the live xterm instance.
- `window.__mobilyMessages`: parsed messages sent through
  `window.ReactNativeWebView.postMessage()`.
- `window.__mobilyTerminalLines()`: the visible terminal rows as text.

This seam does not run React Native or `WsClient`. Drive the same WebView
messages that `TerminalView` sends, then assert the messages the WebView would
send back to React Native.

## Run the loop

Run commands inside Linux or WSL from the repository root:

```bash
pnpm --filter mobily-android exec playwright test \
  --grep "sends a vertical swipe to a mouse-enabled TUI"
```

Run the complete terminal browser suite:

```bash
pnpm --filter mobily-android run test:browser
```

During diagnosis, a stable line selector is also useful:

```bash
pnpm --filter mobily-android exec playwright test \
  android/tests/browser/terminalSnapshot.pw.mjs:183
```

Line numbers move as tests are added, so use the test title in durable notes.

## Reproduce an OpenCode-style owned terminal

An OpenCode-style fixture needs four independent pieces of state:

1. A detailed Session Snapshot with a desktop-sized grid.
2. Android Terminal Size Ownership, so the WebView proposes a phone-sized
   readable grid.
3. DEC mouse reporting enabled by the TUI.
4. A synthetic touch sequence inside the rendered xterm screen.

### 1. Paint the desktop Session Snapshot

Use the existing fixture and snapshot dispatcher:

```js
await dispatchSnapshot(page, openCodeSnapshotForGrid(200, 60));
```

`openCodeSnapshotForGrid()` creates a styled alternate-screen snapshot.
`dispatchSnapshot()` waits for `snapshot-applied`, so assertions do not race
xterm parsing.

### 2. Grant Android size ownership

Send the same message that `TerminalView.setSizeOwnership(true)` sends:

```js
await page.evaluate(() => {
  window.__mobilyMessages = [];
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ type: 'size-ownership', owned: true }),
    }),
  );
});

await expect
  .poll(() =>
    page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'resize')),
  )
  .toBe(true);
```

The document derives a readable grid from its current viewport, resizes its
local xterm, and emits `{type: "resize", cols, rows}`. The test
`fills the phone viewport with a readable grid after Android gains size
ownership` is the canonical geometry example.

If the scenario needs the Station's resize acknowledgement too, read the
proposed dimensions from `__mobilyMessages` and dispatch a `resize` message
with the same columns and rows.

### 3. Enable TUI mouse reporting

An alternate screen and mouse reporting are separate terminal modes. Do not
assume `activeScreen: "alternate"` means the application requested mouse
events. Send the DEC modes that a mouse-enabled TUI emits:

```js
window.dispatchEvent(
  new MessageEvent('message', {
    data: JSON.stringify({
      type: 'write',
      data: '\u001b[?1000;1006h',
    }),
  }),
);

await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
```

- `1000h` enables button-event mouse reporting.
- `1006h` selects SGR mouse coordinates.
- `1049h` enters the alternate screen when the fixture did not already do so.

Wait for xterm to parse the write before dispatching touch events.

### 4. Dispatch a swipe inside the terminal

Always derive coordinates from `.xterm-screen`; hard-coded page coordinates
become invalid after Fit, zoom, ownership resize, or a font change.

```js
const viewport = document.getElementById('viewport');
const screen = document.querySelector('.xterm-screen').getBoundingClientRect();
const start = {
  clientX: screen.left + screen.width / 2,
  clientY: screen.top + 100,
};
const end = {
  clientX: start.clientX,
  clientY: start.clientY + 180,
};

const dispatchTouch = (type, touches, changedTouches = touches) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches });
  viewport.dispatchEvent(event);
};

window.__mobilyMessages = [];
dispatchTouch('touchstart', [start]);
dispatchTouch('touchmove', [end]);
dispatchTouch('touchend', [], [end]);
```

The WebView should emit one or more SGR wheel packets:

```js
const inputs = window.__mobilyMessages
  .filter((message) => message.type === 'input')
  .map((message) => message.data);

expect(inputs.some((data) => /^(?:\u001b\[<64;\d+;\d+M)+$/.test(data))).toBe(true);
```

SGR button `64` is wheel up and `65` is wheel down. A tap instead emits button
`0` press and release packets ending in uppercase `M` and lowercase `m`.

## The minimized scrolling regression

The original device report appeared after automatic Android ownership was
enabled, so ownership was included in the first reproduction. Removing
ownership kept the test red. It was therefore not load-bearing and was removed
from the minimal regression.

The actual failing state was:

1. xterm had scrollback (`buffer.active.baseY > 0`).
2. The viewport was at the bottom
   (`buffer.active.viewportY === buffer.active.baseY`).
3. TUI mouse reporting was active.
4. A vertical swipe was dispatched.

The old router saw that history existed and scrolled xterm locally, producing
no input for OpenCode. The regression test
`sends a vertical swipe to a mouse-enabled TUI when terminal history is at
bottom` covers both sides of the corrected boundary:

- At history bottom, the swipe emits SGR wheel input and leaves `viewportY`
  unchanged.
- After `terminal.scrollLines(-10)`, the same swipe moves local history and
  emits no TUI input.

For this distinction, `baseY` means history exists; it does not mean the user
is viewing history. The user is viewing history only when:

```js
terminal.buffer.active.viewportY < terminal.buffer.active.baseY;
```

## Gesture-routing order

When diagnosing a swipe, check the routing predicates in this order:

1. Selection mode owns selection gestures.
2. Two fingers own pinch zoom.
3. Overflow on the gesture axis owns viewport pan.
4. A viewport already above history bottom owns local history scrolling.
5. Active TUI mouse reporting owns mouse-wheel scrolling.
6. Non-mouse terminal history receives local history scrolling.
7. A remaining short gesture resolves as keyboard focus or a TUI click.

Clear `window.__mobilyMessages` immediately before the gesture so readiness,
resize, snapshot, or earlier input frames do not pollute the verdict.

## Related regression tests

Use these tests as templates instead of starting a new harness:

- `fills the phone viewport with a readable grid after Android gains size
ownership`: desktop grid to readable phone grid.
- `scrolls a mouse-enabled alternate-screen TUI with a vertical swipe`:
  alternate-screen wheel delivery without scrollback.
- `sends a vertical swipe to a mouse-enabled TUI when terminal history is at
bottom`: TUI wheel delivery versus local history.
- `pans the terminal horizontally with one finger after zooming in`: viewport
  overflow and pan.
- `does not write stale mouse packets into a shell prompt`: TUI-to-shell mouse
  reset.
- `restores TUI swipe scrolling when connection scrollback contains mouse
mode`: reconnect and scrollback reconstruction.

## Production asset and validation checklist

`TerminalView.tsx` uses the generated helper bundle in
`android/src/terminal/xtermAssets.generated.ts`.

If a helper function serialized by `buildTerminalHelpersSource()` changes, run:

```bash
pnpm --filter mobily-android generate:terminal-assets
```

Changes only to the surrounding WebView document string, such as touch-routing
code, do not require regenerating the helper bundle.

Before handing off a terminal renderer fix:

```bash
pnpm --filter mobily-android typecheck
pnpm --filter mobily-android lint
pnpm --filter mobily-android test
pnpm --filter mobily-android run test:browser
```

With Metro, reload the Android app to pick up JavaScript and regenerated
terminal assets. Rebuild the APK only when testing a standalone bundled APK or
when native dependencies/configuration changed.
