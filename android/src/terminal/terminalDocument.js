export const DEFAULT_READABLE_FONT_SIZE = 14;
export const MIN_READABLE_FONT_SIZE = 10;
export const MAX_READABLE_FONT_SIZE = 28;

export function clampTerminalScale(value) {
  return Math.max(0.2, Math.min(3, value));
}

export function clampTerminalFontSize(fontSize) {
  if (typeof fontSize !== 'number' || !Number.isFinite(fontSize)) return DEFAULT_READABLE_FONT_SIZE;
  return Math.max(MIN_READABLE_FONT_SIZE, Math.min(MAX_READABLE_FONT_SIZE, Math.round(fontSize)));
}

/**
 * Fallback monospace cell metrics used when xterm has not measured yet.
 * Tuned to Cascadia/Courier-like proportions at the default readable size
 * (14px → 8.4×16.8).
 */
export function estimateTerminalCellSize(fontSize) {
  var size = clampTerminalFontSize(fontSize);
  return { width: size * 0.6, height: size * 1.2 };
}

/** Subtract Mobily chrome and system occupancy from a raw layout box. */
export function usableTerminalViewport(layout) {
  if (!layout) return { width: 0, height: 0 };
  var width = Math.max(0, (layout.width || 0) - (layout.horizontalInset || 0));
  var height = Math.max(
    0,
    (layout.height || 0) -
      (layout.topInset || 0) -
      (layout.bottomInset || 0) -
      (layout.keyboardHeight || 0) -
      (layout.controlsHeight || 0) -
      (layout.extraKeyRowHeight || 0),
  );
  return { width: width, height: height };
}

export function deriveReadableTerminalGrid(viewportWidth, viewportHeight, cellWidth, cellHeight) {
  if (!(viewportWidth > 0) || !(viewportHeight > 0) || !(cellWidth > 0) || !(cellHeight > 0)) {
    return { cols: 1, rows: 1 };
  }
  return {
    cols: Math.max(1, Math.min(1000, Math.floor(viewportWidth / cellWidth))),
    rows: Math.max(1, Math.min(1000, Math.floor(viewportHeight / cellHeight))),
  };
}

export function createDebouncedGridProposer(emit, debounceMs) {
  var delay = typeof debounceMs === 'number' && debounceMs >= 0 ? debounceMs : 100;
  var timer = null;
  var pending = null;
  var lastSent = null;
  return {
    propose: function (cols, rows) {
      if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
      if (cols < 1 || rows < 1 || cols > 1000 || rows > 1000) return;
      if (lastSent && lastSent.cols === cols && lastSent.rows === rows && !pending) return;
      pending = { cols: cols, rows: rows };
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        var next = pending;
        pending = null;
        if (!next) return;
        if (lastSent && lastSent.cols === next.cols && lastSent.rows === next.rows) return;
        lastSent = next;
        emit(next.cols, next.rows);
      }, delay);
    },
    acknowledge: function (cols, rows) {
      if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
      lastSent = { cols: cols, rows: rows };
    },
    reset: function () {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      lastSent = null;
    },
  };
}

export function fitTerminalScale(viewportWidth, viewportHeight, terminalWidth, terminalHeight) {
  if (
    !(viewportWidth > 0) ||
    !(viewportHeight > 0) ||
    !(terminalWidth > 0) ||
    !(terminalHeight > 0)
  ) {
    return 1;
  }
  return Math.min(3, viewportWidth / terminalWidth, viewportHeight / terminalHeight);
}

export function pinchTerminalScale(initialScale, initialDistance, currentDistance) {
  if (initialDistance <= 0) return clampTerminalScale(initialScale);
  return clampTerminalScale((initialScale * currentDistance) / initialDistance);
}

/** DEC private modes that enable click / drag / motion mouse reporting. */
var TERMINAL_MOUSE_REPORTING_PARAMS = { 1000: 1, 1002: 1, 1003: 1 };
/** DEC private modes that switch the alternate screen buffer. */
var TERMINAL_ALTERNATE_SCREEN_PARAMS = { 47: 1, 1047: 1, 1049: 1 };
var MOBILY_SHELL_PROMPT = '[mobily] ';
/** Leave alternate screen so shell output can accumulate normal-buffer scrollback. */
var LEAVE_ALTERNATE_SCREEN = '\x1b[?1049l';

/**
 * Strip mouse tracking DECSET/DECRST params (used by the workstation embed).
 * The Android WebView path preserves these and tracks them instead.
 */
export function stripTerminalMouseControls(data) {
  return data.replace(/\x1b\[\?([0-9;]+)([hl])/g, function (_sequence, parameters, command) {
    var remaining = parameters.split(';').filter(function (parameter) {
      return ['1000', '1002', '1003', '1005', '1006', '1015'].indexOf(parameter) < 0;
    });
    return remaining.length ? '\x1b[?' + remaining.join(';') + command : '';
  });
}

/** Mutable mouse-mode / alternate-screen tracker for the Android terminal document. */
export function createTerminalMouseModeState() {
  return { modes: {}, promptTail: '', alternateScreen: false };
}

/**
 * Preserve DEC mouse controls in `data` while updating whether click reporting
 * is active. When the Mobily shell prompt returns while xterm is still on the
 * alternate screen (abrupt TUI exit without DECRST 1049), inject a leave
 * sequence so subsequent shell output accumulates normal-buffer scrollback.
 */
export function applyTerminalMouseControls(state, data) {
  if (!state || typeof data !== 'string') return data;
  if (!state.modes) state.modes = {};
  var promptTail = typeof state.promptTail === 'string' ? state.promptTail : '';
  var stream = promptTail + data;
  var eventPattern = /\x1b\[\?([0-9;]+)([hl])|\[mobily\] /g;
  var match;
  var leaveAt = [];
  var straddlingReplay = '';
  while ((match = eventPattern.exec(stream))) {
    if (match[0] === MOBILY_SHELL_PROMPT) {
      // Mobily owns this prompt prefix, so it is a reliable process boundary:
      // a TUI has returned to the shell even if it omitted DECRST mouse modes
      // or the alternate-screen leave sequence.
      state.modes = {};
      if (state.alternateScreen) {
        state.alternateScreen = false;
        var dataIndex = match.index - promptTail.length;
        if (dataIndex < 0) {
          // Prompt completed across chunks: the already-written prefix lived on
          // the alternate buffer (discarded by leave). Replay it on normal.
          straddlingReplay = LEAVE_ALTERNATE_SCREEN + promptTail.slice(match.index);
        } else {
          leaveAt.push(dataIndex);
        }
      }
      continue;
    }
    var parameters = match[1];
    var command = match[2];
    var enable = command === 'h';
    var values = parameters.split(';');
    // Returning from an alternate-screen TUI is a safety boundary. If its
    // mouse-disable sequence was lost or omitted, never forward stale mouse
    // packets into the shell prompt that becomes visible next.
    if (!enable && values.indexOf('1049') >= 0) state.modes = {};
    values.forEach(function (parameter) {
      if (TERMINAL_ALTERNATE_SCREEN_PARAMS[parameter]) state.alternateScreen = enable;
      if (!TERMINAL_MOUSE_REPORTING_PARAMS[parameter]) return;
      if (enable) state.modes[parameter] = 1;
      else delete state.modes[parameter];
    });
  }
  state.promptTail = stream.slice(-(MOBILY_SHELL_PROMPT.length - 1));
  if (!leaveAt.length && !straddlingReplay) return data;
  var output = data;
  if (leaveAt.length) {
    leaveAt.sort(function (a, b) {
      return b - a;
    });
    var last = -1;
    leaveAt.forEach(function (at) {
      if (at === last) return;
      last = at;
      output = output.slice(0, at) + LEAVE_ALTERNATE_SCREEN + output.slice(at);
    });
  }
  return straddlingReplay ? straddlingReplay + output : output;
}

export function isTerminalMouseReportingActive(state) {
  return !!(state && state.modes && Object.keys(state.modes).length > 0);
}

/** Rebuild the active tracking mode from historical terminal output using SGR coordinates. */
export function restoreTerminalMouseControls(data) {
  var state = createTerminalMouseModeState();
  applyTerminalMouseControls(state, data);
  var modes = Object.keys(state.modes).sort(function (a, b) {
    return Number(a) - Number(b);
  });
  return modes.length ? '\x1b[?' + modes.join(';') + ';1006h' : '';
}

/** SGR (1006) left-button press+release at 0-based screen cell coordinates. */
export function sgrMouseClickSequence(col, row) {
  var c = Math.max(0, col | 0) + 1;
  var r = Math.max(0, row | 0) + 1;
  return '\x1b[<0;' + c + ';' + r + 'M\x1b[<0;' + c + ';' + r + 'm';
}

/** SGR (1006) mouse-wheel event at 0-based screen cell coordinates. */
export function sgrMouseWheelSequence(direction, col, row) {
  var button = direction === 'up' ? 64 : 65;
  var c = Math.max(0, col | 0) + 1;
  var r = Math.max(0, row | 0) + 1;
  return '\x1b[<' + button + ';' + c + ';' + r + 'M';
}

/** Disable mobile IME word suggestions on xterm's helper textarea. */
export function hardenTerminalTextarea(term) {
  var textarea = term && term.textarea;
  if (!textarea && term && term.element) {
    textarea = term.element.querySelector('.xterm-helper-textarea');
  }
  if (!textarea || !textarea.setAttribute) return;
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('spellcheck', 'false');
}

/**
 * Focus xterm's helper textarea so the soft keyboard can open.
 * Call only when a tap resolves (touchend of an uncancelled gesture). Focusing
 * at touchstart opens the IME for gestures that turn out to be swipes or pans,
 * and a focus request whose IME Android suppresses leaves the textarea as
 * activeElement without the keyboard — after which focus() is a no-op and the
 * keyboard stays unreachable until something else blurs the element.
 */
export function focusTerminalInput(term) {
  if (!term) return;
  try {
    if (typeof term.focus === 'function') term.focus();
  } catch (_) {}
  var textarea = term.textarea;
  if (!textarea && term.element) {
    textarea = term.element.querySelector('.xterm-helper-textarea');
  }
  if (!textarea || typeof textarea.focus !== 'function') return;
  try {
    textarea.focus();
  } catch (_) {}
}

export function terminalSelectionRange(start, end, cols) {
  var first = start;
  var last = end;
  if (last.row < first.row || (last.row === first.row && last.col < first.col)) {
    first = end;
    last = start;
  }
  return {
    column: first.col,
    row: first.row,
    length: Math.max(1, (last.row - first.row) * cols + last.col - first.col + 1),
  };
}

function terminalCellSgr(cell) {
  var attrs = Number.isInteger(cell.attrs) ? cell.attrs : 0;
  var codes = [];
  if (attrs & 1) codes.push(1);
  if (attrs & 2) codes.push(2);
  if (attrs & 4) codes.push(3);
  if (attrs & 8) codes.push(4);
  if (attrs & 16) codes.push(5);
  if (attrs & 32) codes.push(7);
  if (attrs & 64) codes.push(8);
  if (attrs & 128) codes.push(9);
  if (attrs & 256) codes.push(53);
  if (cell.fg) {
    if (cell.fg.mode === 'palette') codes.push(38, 5, cell.fg.value);
    else if (cell.fg.mode === 'rgb')
      codes.push(
        38,
        2,
        (cell.fg.value >> 16) & 255,
        (cell.fg.value >> 8) & 255,
        cell.fg.value & 255,
      );
  }
  if (cell.bg) {
    if (cell.bg.mode === 'palette') codes.push(48, 5, cell.bg.value);
    else if (cell.bg.mode === 'rgb')
      codes.push(
        48,
        2,
        (cell.bg.value >> 16) & 255,
        (cell.bg.value >> 8) & 255,
        cell.bg.value & 255,
      );
  }
  return codes.join(';');
}

/** Convert a validated Session Snapshot into a complete xterm redraw. */
export function snapshotToAnsi(snapshot) {
  // Revalidate at the WebView bridge even though the wire decoder validates
  // first; injected messages are a distinct trust boundary.
  if (
    !snapshot ||
    snapshot.type !== 'session-snapshot' ||
    !Number.isInteger(snapshot.cols) ||
    !Number.isInteger(snapshot.rows) ||
    snapshot.cols < 1 ||
    snapshot.rows < 1 ||
    snapshot.cols > 1000 ||
    snapshot.rows > 1000 ||
    snapshot.cols * snapshot.rows > 100000 ||
    (snapshot.activeScreen !== 'normal' && snapshot.activeScreen !== 'alternate') ||
    !Array.isArray(snapshot.grid) ||
    snapshot.grid.length !== snapshot.rows ||
    !snapshot.cursor
  )
    return null;
  var output = '\x1bc';
  if (snapshot.activeScreen === 'alternate') output += '\x1b[?1049h';
  var currentStyle = null;
  for (var row = 0; row < snapshot.rows; row++) {
    var cells = snapshot.grid[row];
    if (!Array.isArray(cells) || cells.length !== snapshot.cols) return null;
    output += '\x1b[' + (row + 1) + ';1H';
    for (var col = 0; col < snapshot.cols; col++) {
      var cell = cells[col];
      if (
        !cell ||
        typeof cell.chars !== 'string' ||
        cell.chars.length > 64 ||
        (cell.width !== 0 && cell.width !== 1 && cell.width !== 2)
      )
        return null;
      if (cell.width === 0) continue;
      var style = terminalCellSgr(cell);
      if (style !== currentStyle) {
        output += '\x1b[0' + (style ? ';' + style : '') + 'm';
        currentStyle = style;
      }
      output += cell.chars || ' ';
    }
  }
  var cursor = snapshot.cursor;
  if (
    !Number.isInteger(cursor.col) ||
    !Number.isInteger(cursor.row) ||
    cursor.col < 0 ||
    cursor.col > snapshot.cols ||
    cursor.row < 0 ||
    cursor.row >= snapshot.rows ||
    typeof cursor.visible !== 'boolean' ||
    typeof cursor.blink !== 'boolean' ||
    ['block', 'underline', 'bar'].indexOf(cursor.style) < 0
  )
    return null;
  var cursorCode =
    cursor.style === 'underline'
      ? cursor.blink
        ? 3
        : 4
      : cursor.style === 'bar'
        ? cursor.blink
          ? 5
          : 6
        : cursor.blink
          ? 1
          : 2;
  output +=
    '\x1b[0m\x1b[' +
    cursorCode +
    ' q\x1b[?' +
    (cursor.visible ? '25h' : '25l') +
    '\x1b[' +
    (cursor.row + 1) +
    ';' +
    (cursor.col + 1) +
    'H';
  return output;
}

/** Rebuild bounded history and then restore the current screen without exposing the rebuild. */
export function scrollbackAndSnapshotToAnsi(scrollback, snapshot, liveOutput = '') {
  if (typeof scrollback !== 'string' || scrollback.length > MAX_SESSION_SCROLLBACK_CHARS)
    return null;
  if (typeof liveOutput !== 'string') return null;
  const snapshotAnsi = snapshotToAnsi(snapshot);
  if (snapshotAnsi === null) return null;
  const mouseControls =
    snapshot.activeScreen === 'normal'
      ? '\x1b[?1000;1002;1003;1005;1006;1015l'
      : restoreTerminalMouseControls(scrollback);
  return (
    '\x1bc' +
    scrollback.replace(/\x00/g, '') +
    '\x1b[?1049l\x1b[0m\x1b[2J\x1b[H' +
    snapshotAnsi.slice(2) +
    mouseControls +
    liveOutput
  );
}

export function buildTerminalHelpersSource() {
  return [
    'var TERMINAL_MOUSE_REPORTING_PARAMS = ' +
      JSON.stringify(TERMINAL_MOUSE_REPORTING_PARAMS) +
      ';',
    'var TERMINAL_ALTERNATE_SCREEN_PARAMS = ' +
      JSON.stringify(TERMINAL_ALTERNATE_SCREEN_PARAMS) +
      ';',
    'var MOBILY_SHELL_PROMPT = ' + JSON.stringify(MOBILY_SHELL_PROMPT) + ';',
    'var LEAVE_ALTERNATE_SCREEN = ' + JSON.stringify(LEAVE_ALTERNATE_SCREEN) + ';',
    clampTerminalScale,
    clampTerminalFontSize,
    estimateTerminalCellSize,
    usableTerminalViewport,
    deriveReadableTerminalGrid,
    createDebouncedGridProposer,
    fitTerminalScale,
    pinchTerminalScale,
    stripTerminalMouseControls,
    createTerminalMouseModeState,
    applyTerminalMouseControls,
    isTerminalMouseReportingActive,
    restoreTerminalMouseControls,
    sgrMouseClickSequence,
    sgrMouseWheelSequence,
    hardenTerminalTextarea,
    focusTerminalInput,
    terminalSelectionRange,
    terminalCellSgr,
    snapshotToAnsi,
    scrollbackAndSnapshotToAnsi,
  ]
    .map((helper) => (typeof helper === 'string' ? helper : helper.toString()))
    .join('\n');
}

/** Shared production terminal document used by the app and browser harness. */
export function buildTerminalDocument({
  xtermCss,
  xtermJs,
  xtermFitJs,
  devBridgeJs = '',
  terminalHelpersJs,
}) {
  const XTERM_CSS = xtermCss;
  const XTERM_JS = xtermJs;
  const XTERM_FIT_JS = xtermFitJs;
  const DEV_BRIDGE_JS = devBridgeJs;
  const VIEWPORT_HELPERS =
    `var MAX_SESSION_SCROLLBACK_CHARS=${MAX_SESSION_SCROLLBACK_CHARS};\n` +
    `var DEFAULT_READABLE_FONT_SIZE=${DEFAULT_READABLE_FONT_SIZE};\n` +
    `var MIN_READABLE_FONT_SIZE=${MIN_READABLE_FONT_SIZE};\n` +
    `var MAX_READABLE_FONT_SIZE=${MAX_READABLE_FONT_SIZE};\n` +
    (terminalHelpersJs ?? buildTerminalHelpersSource());
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-mobily-terminal'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
  <title>mobily terminal</title>
  <style>${XTERM_CSS}</style>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #1a1a1a; width: 100%; height: 100%; overflow: hidden; }
    #root { display: flex; flex-direction: column; width: 100%; height: 100%; }
    #key-row {
      display: flex; flex-shrink: 0; background: #111;
      border-bottom: 1px solid #333; overflow-x: auto; overflow-y: hidden;
      scrollbar-width: none;
    }
    #key-row::-webkit-scrollbar { display: none; }
    .key-btn {
      min-width: 44px; height: 36px; padding: 0 10px; border: none;
      border-right: 1px solid #2a2a2a; background: #1c1c1c; color: #ccc;
      font-size: 13px; cursor: pointer; user-select: none;
      -webkit-tap-highlight-color: transparent;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.1s; white-space: nowrap; flex-shrink: 0;
    }
    .key-btn:active { background: #333; }
    .key-btn.armed { background: #1e3a5f; color: #58a6ff; }
    #viewport { flex: 1; min-height: 0; overflow: auto; position: relative; overscroll-behavior: contain; }
    #stage { position: relative; min-width: 100%; min-height: 100%; }
    .terminal-surface { position: absolute; left: 0; top: 0; padding: 4px; transform-origin: 0 0; }
    .terminal-surface .xterm { height: 100%; }
    #connection-overlay {
      position: absolute; inset: 0; z-index: 20; pointer-events: none;
      display: flex; align-items: center; justify-content: center;
      color: #c9d1d9; font: 600 14px system-ui, sans-serif;
    }
    #connection-overlay[data-state="loading"] { background: rgba(13,17,23,0.92); }
    #connection-overlay[data-state="reconnecting"] {
      align-items: flex-start; justify-content: center; padding-top: 12px;
      background: linear-gradient(rgba(13,17,23,0.38), transparent 30%);
    }
    #connection-overlay[data-state="reconnecting"] #connection-status {
      border: 1px solid #6e5b16; border-radius: 999px; padding: 7px 12px;
      color: #f2cc60; background: rgba(13,17,23,0.9);
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    }
    #connection-overlay[data-state="live"] { display: none; }
    body.selecting #viewport { touch-action: none; }
  </style>
</head>
<body>
<div id="root">
  <div id="key-row" style="display:none">
    <button class="key-btn" data-seq="ESC">Esc</button>
    <button class="key-btn" id="ctrl-btn" data-toggle="ctrl">Ctrl</button>
    <button class="key-btn" id="alt-btn" data-toggle="alt">Alt</button>
    <button class="key-btn" data-seq="TAB">Tab</button>
    <button class="key-btn" data-seq="LEFT">&#9664;</button>
    <button class="key-btn" data-seq="RIGHT">&#9654;</button>
    <button class="key-btn" data-seq="UP">&#9650;</button>
    <button class="key-btn" data-seq="DOWN">&#9660;</button>
    <button class="key-btn" data-seq="ENTER">&#9166;</button>
    <button class="key-btn" data-seq="CTRL_C">Ctrl+C</button>
    <button class="key-btn" data-seq="CTRL_D">Ctrl+D</button>
    <button class="key-btn" data-seq="CTRL_Z">Ctrl+Z</button>
    <button class="key-btn" data-seq="CTRL_L">Ctrl+L</button>
    <button class="key-btn" data-seq="END">End</button>
    <button class="key-btn" data-seq="PGUP">PgUp</button>
    <button class="key-btn" data-seq="PGDN">PgDn</button>
  </div>
  <div id="viewport">
    <div id="stage"><div id="tc" class="terminal-surface"></div></div>
    <div id="connection-overlay" data-state="loading">
      <div id="connection-status">Loading Session&hellip;</div>
    </div>
  </div>
</div>
<script nonce="mobily-terminal">${XTERM_JS}</script>
<script nonce="mobily-terminal">${XTERM_FIT_JS}</script>
<script nonce="mobily-terminal">${DEV_BRIDGE_JS}</script>
<script nonce="mobily-terminal">
${VIEWPORT_HELPERS}
(function(){
  'use strict';
  var KEY_SEQS={ESC:'\\x1b',TAB:'\\t',LEFT:'\\x1b[D',RIGHT:'\\x1b[C',UP:'\\x1b[A',DOWN:'\\x1b[B',ENTER:'\\r',CTRL_C:'\\x03',CTRL_D:'\\x04',CTRL_Z:'\\x1a',CTRL_L:'\\x0c',END:'\\x1b[F',PGUP:'\\x1b[5~',PGDN:'\\x1b[6~'};
  var pendingLat={},latSamples=[],ctrlArmed=false,altArmed=false;
  var outQ=[],rafPending=false,term=null,snapshotInFlight=false,snapshotToken=0;
  var scale=1,fitMode=true,selectionMode=false,mouseCarry='',mouseModeState=createTerminalMouseModeState(),selectionStart=null,touchGesture=null,pinchDistance=0,pinchScale=1,viewportLayoutRaf=0,hasAppliedInitialFit=false;
  var fontSize=DEFAULT_READABLE_FONT_SIZE,ownsSize=false,SURFACE_PAD=8;
  var gridProposer=createDebouncedGridProposer(function(cols,rows){
    if(!term)return;
    term.resize(cols,rows);
    scale=1;
    fitOwnedViewToWidth();
    sendRN({type:'resize',cols:cols,rows:rows});
    scheduleViewportLayout();
  },100);

  function setArmed(mod,v){
    if(mod==='ctrl'){ctrlArmed=v;var b=document.getElementById('ctrl-btn');if(b)b.classList.toggle('armed',v);}
    else{altArmed=v;var a=document.getElementById('alt-btn');if(a)a.classList.toggle('armed',v);}
  }
  function recordEcho(tags){
    if(!Array.isArray(tags))return;
    var now=performance.now(),added=0;
    tags.slice(0,256).forEach(function(tag){
      if(typeof tag==='string'&&pendingLat[tag]!==undefined){
        latSamples.push(now-pendingLat[tag]);delete pendingLat[tag];added++;
      }
    });
    if(latSamples.length>1000)latSamples=latSamples.slice(-1000);
    if(added&&latSamples.length%20<added)emitLatStats();
  }
  function emitLatStats(){
    if(!latSamples.length)return;
    var s=latSamples.slice().sort(function(a,b){return a-b;});
    var p50=s[Math.floor(s.length*.5)],p95=s[Math.floor(s.length*.95)];
    sendRN({type:'latency-stats',n:s.length,p50:Math.round(p50),p95:Math.round(p95)});
  }
  function enqueue(data,tags){
    recordEcho(tags);outQ.push(data);
    if(!snapshotInFlight)scheduleOutput();
  }
  function scheduleOutput(){
    if(rafPending||snapshotInFlight||!outQ.length)return;
    rafPending=true;requestAnimationFrame(function(){
      rafPending=false;if(snapshotInFlight||!outQ.length)return;
      var chunk=prepareOutput(outQ.join(''));outQ=[];if(term)term.write(chunk);
    });
  }
  function sendRN(msg){
    try{
      var data=JSON.stringify(msg);
      if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(data);
      else if(window.parent&&window.parent!==window)window.parent.postMessage({source:'mobily-terminal',payload:data},'*');
    }catch(_){}
  }
  function sendInput(data){
    if(ctrlArmed&&data.length===1){
      data=String.fromCharCode(data.charCodeAt(0)&0x1f);setArmed('ctrl',false);
    }
    if(altArmed&&data.length>0){data='\\x1b'+data;setArmed('alt',false);}
    var values=new Uint32Array(1);crypto.getRandomValues(values);
    var tag='lat-'+values[0].toString(16).padStart(8,'0');
    pendingLat[tag]=performance.now();
    var pendingTags=Object.keys(pendingLat);if(pendingTags.length>256)delete pendingLat[pendingTags[0]];
    sendRN({type:'input',data:data,latencyTag:tag});
  }
  function prepareOutput(data){
    var value=mouseCarry+data;mouseCarry='';
    var pending=value.match(/\x1b(?:\[|\[\?[0-9;]*)$/);
    if(pending){mouseCarry=pending[0];value=value.slice(0,-pending[0].length);}
    return applyTerminalMouseControls(mouseModeState,value);
  }
  function resetMouseTracking(){
    mouseCarry='';
    mouseModeState=createTerminalMouseModeState();
    touchGesture=null;
  }
  function terminalOptions(cols,rows){
    return {allowProposedApi:true,cursorBlink:true,fontSize:fontSize,cols:cols,rows:rows,
      fontFamily:"'Cascadia Code','JetBrains Mono','Fira Code','Courier New',monospace",
      theme:{background:'#1a1a1a',foreground:'#e6e6e6',cursor:'#e6e6e6',
        black:'#1a1a1a',red:'#da3633',green:'#2ea043',yellow:'#e3b341',
        blue:'#58a6ff',magenta:'#bc8cff',cyan:'#39c5cf',white:'#b1bac4',
        brightBlack:'#484f58',brightRed:'#f85149',brightGreen:'#56d364',
        brightYellow:'#e3b341',brightBlue:'#79c0ff',brightMagenta:'#d2a8ff',
        brightCyan:'#56d4dd',brightWhite:'#f0f6fc'},scrollback:5000,convertEol:false};
  }
  function openTerminal(container,cols,rows){
    var next=new Terminal(terminalOptions(cols,rows));
    next.loadAddon(new FitAddon.FitAddon());next.open(container);hardenTerminalTextarea(next);return next;
  }
  function bindTerminalInput(target){
    target.onData(function(d){sendInput(d);});
  }
  function setConnectionState(state,detail){
    if(['loading','reconnecting','live'].indexOf(state)<0)return;
    if(state==='reconnecting'){
      // A reconnect transition supersedes every frame and queued output from
      // the socket that just dropped, including a snapshot still parsing in
      // the hidden staging terminal.
      snapshotToken++;snapshotInFlight=false;outQ=[];resetMouseTracking();
    }
    var overlay=document.getElementById('connection-overlay');
    var status=document.getElementById('connection-status');
    overlay.setAttribute('data-state',state);
    status.textContent=state==='reconnecting'
      ? 'Reconnecting\u2026'+(detail?' ('+detail+')':'')
      : state==='loading'?'Loading Session\u2026':'';
  }
  function applySnapshot(snapshot){
    var snapshotAnsi=snapshotToAnsi(snapshot);if(snapshotAnsi===null)return;
    outQ=[];resetMouseTracking();applyTerminalMouseControls(mouseModeState,snapshotAnsi);snapshotInFlight=true;
    var token=++snapshotToken,oldTerm=term;
    var oldContainer=oldTerm&&oldTerm.element&&oldTerm.element.parentElement;
    var nextContainer=document.createElement('div');
    nextContainer.className='terminal-surface';nextContainer.style.visibility='hidden';
    document.getElementById('stage').appendChild(nextContainer);
    var nextTerm=openTerminal(nextContainer,snapshot.cols,snapshot.rows);
    nextTerm.write(snapshotAnsi,function(){
      if(token!==snapshotToken){
        nextTerm.dispose();nextContainer.remove();return;
      }
      nextContainer.id='tc';nextContainer.style.visibility='visible';
      if(oldContainer){oldContainer.removeAttribute('id');oldContainer.remove();}
      if(oldTerm)oldTerm.dispose();
      term=nextTerm;bindTerminalInput(term);snapshotInFlight=false;
      gridProposer.acknowledge(snapshot.cols,snapshot.rows);
      if(typeof window.__mobilyInspectTerminal==='function')window.__mobilyInspectTerminal(term);
      scheduleOutput();
      presentSessionLayout();
      sendRN({type:'snapshot-applied'});
    });
  }
  function applyScrollback(scrollback,snapshot,liveOutput){
    var ansi=scrollbackAndSnapshotToAnsi(scrollback,snapshot,liveOutput);if(ansi===null)return;
    outQ=[];resetMouseTracking();applyTerminalMouseControls(mouseModeState,ansi);snapshotInFlight=true;
    var token=++snapshotToken,oldTerm=term;
    var oldContainer=oldTerm&&oldTerm.element&&oldTerm.element.parentElement;
    var nextContainer=document.createElement('div');
    nextContainer.className='terminal-surface';nextContainer.style.visibility='hidden';
    document.getElementById('stage').appendChild(nextContainer);
    var nextTerm=openTerminal(nextContainer,snapshot.cols,snapshot.rows);
    nextTerm.write(ansi,function(){
      if(token!==snapshotToken){
        nextTerm.dispose();nextContainer.remove();return;
      }
      nextTerm.scrollToBottom();
      nextContainer.id='tc';nextContainer.style.visibility='visible';
      if(oldContainer){oldContainer.removeAttribute('id');oldContainer.remove();}
      if(oldTerm)oldTerm.dispose();
      term=nextTerm;bindTerminalInput(term);snapshotInFlight=false;
      gridProposer.acknowledge(snapshot.cols,snapshot.rows);
      if(typeof window.__mobilyInspectTerminal==='function')window.__mobilyInspectTerminal(term);
      scheduleOutput();
      presentSessionLayout();
    });
  }
  function terminalPixels(){
    var screen=term&&term.element&&term.element.querySelector('.xterm-screen');
    var cell=cellMetrics();
    var canvas=rendererCanvasPixels();
    var renderedWidth=screen&&Math.max(screen.offsetWidth||0,screen.scrollWidth||0)||0;
    var renderedHeight=screen&&Math.max(screen.offsetHeight||0,screen.scrollHeight||0)||0;
    return {
      width:Math.max(1,renderedWidth,canvas.width,term.cols*cell.width)+SURFACE_PAD,
      height:Math.max(1,renderedHeight,canvas.height,term.rows*cell.height)+SURFACE_PAD
    };
  }
  function applyScale(next,exactFit){
    if(!term)return;
    scale=exactFit&&typeof next==='number'&&Number.isFinite(next)&&next>0
      ? Math.min(3,next)
      : clampTerminalScale(next);
    var px=terminalPixels(),tc=document.getElementById('tc'),stage=document.getElementById('stage');
    tc.style.width=px.width+'px';tc.style.height=px.height+'px';tc.style.transform='scale('+scale+')';
    stage.style.width=Math.max(document.getElementById('viewport').clientWidth,px.width*scale)+'px';
    stage.style.height=Math.max(document.getElementById('viewport').clientHeight,px.height*scale)+'px';
  }
  function fitView(){
    if(!term)return;var viewport=document.getElementById('viewport'),px=terminalPixels();
    fitMode=true;
    applyScale(fitTerminalScale(viewport.clientWidth,viewport.clientHeight,px.width,px.height),true);
    viewport.scrollLeft=0;viewport.scrollTop=0;
  }
  function fitOwnedViewToWidth(){
    if(!term)return;var viewport=document.getElementById('viewport'),px=terminalPixels();
    var next=viewport.clientWidth>0?Math.min(1,viewport.clientWidth/px.width):1;
    applyScale(next,true);
    viewport.scrollLeft=0;
  }
  function keepFocusedCursorVisible(){
    if(!term)return;
    var textarea=term.textarea||(term.element&&term.element.querySelector('.xterm-helper-textarea'));
    if(!textarea||document.activeElement!==textarea)return;
    var viewport=document.getElementById('viewport');
    var screen=term.element&&term.element.querySelector('.xterm-screen');
    var screenRect=screen&&screen.getBoundingClientRect();
    var viewportRect=viewport.getBoundingClientRect();
    if(!screenRect||screenRect.height<=0||viewport.clientHeight<=0)return;
    var cursorBottom=
      viewport.scrollTop+
      screenRect.top-viewportRect.top+
      ((term.buffer.active.cursorY+1)*screenRect.height/term.rows);
    var visibleBottom=viewport.scrollTop+viewport.clientHeight-4;
    if(cursorBottom>visibleBottom)viewport.scrollTop+=cursorBottom-visibleBottom;
  }
  function refreshViewportLayout(){
    if(!term)return;
    applyScale(scale,true);
    keepFocusedCursorVisible();
  }
  function presentSessionLayout(){
    if(!hasAppliedInitialFit)hasAppliedInitialFit=true;
    if(fitMode)fitView();else scheduleViewportLayout();
  }
  function scheduleViewportLayout(){
    if(viewportLayoutRaf)return;
    viewportLayoutRaf=requestAnimationFrame(function(){
      viewportLayoutRaf=0;
      var textarea=term&&(term.textarea||(term.element&&term.element.querySelector('.xterm-helper-textarea')));
      var keyboardFocused=!!(textarea&&document.activeElement===textarea);
      if(ownsSize){
        if(fitMode)fitOwnedViewToWidth();else refreshViewportLayout();
        proposeOwnerGrid();
      }
      else if(fitMode&&!keyboardFocused)fitView();
      else refreshViewportLayout();
    });
  }
  function cellMetrics(){
    try{
      var dims=term&&term._core&&term._core._renderService&&term._core._renderService.dimensions;
      if(dims&&dims.css&&dims.css.cell&&dims.css.cell.width>0&&dims.css.cell.height>0){
        return {width:dims.css.cell.width,height:dims.css.cell.height};
      }
    }catch(_){}
    return estimateTerminalCellSize(fontSize);
  }
  function rendererCanvasPixels(){
    try{
      var canvas=term&&term._core&&term._core._renderService&&term._core._renderService.dimensions&&term._core._renderService.dimensions.css&&term._core._renderService.dimensions.css.canvas;
      if(canvas&&canvas.width>0&&canvas.height>0)return {width:canvas.width,height:canvas.height};
    }catch(_){}
    return {width:0,height:0};
  }
  function readableGridForViewport(){
    var viewport=document.getElementById('viewport');
    var cell=cellMetrics();
    return deriveReadableTerminalGrid(
      Math.max(0,viewport.clientWidth-SURFACE_PAD),
      Math.max(0,viewport.clientHeight-SURFACE_PAD),
      cell.width,
      cell.height
    );
  }
  function proposeOwnerGrid(){
    if(!term||!ownsSize)return;
    var grid=readableGridForViewport();
    gridProposer.propose(grid.cols,grid.rows);
  }
  function setFontSize(next){
    var clamped=clampTerminalFontSize(next);
    if(clamped===fontSize&&term&&term.options.fontSize===clamped)return;
    fontSize=clamped;
    if(term)term.options.fontSize=fontSize;
    sendRN({type:'font-size',fontSize:fontSize});
    scheduleViewportLayout();
  }
  function setSizeOwnership(owned){
    ownsSize=!!owned;
    if(ownsSize)scheduleViewportLayout();
    else{
      gridProposer.reset();
      scheduleViewportLayout();
    }
  }
  function setSelectionMode(enabled){
    selectionMode=!!enabled;document.body.classList.toggle('selecting',selectionMode);
    if(term){term.options.disableStdin=selectionMode;if(!selectionMode)term.clearSelection();}
  }
  function terminalScreenCell(touch){
    var screen=term&&term.element&&term.element.querySelector('.xterm-screen');
    var rect=screen&&screen.getBoundingClientRect();
    if(!rect||rect.width<=0||rect.height<=0)return {col:0,row:0};
    var col=Math.max(0,Math.min(term.cols-1,Math.floor((touch.clientX-rect.left)/(rect.width/term.cols))));
    var row=Math.max(0,Math.min(term.rows-1,Math.floor((touch.clientY-rect.top)/(rect.height/term.rows))));
    return {col:col,row:row};
  }
  function isTouchInsideTerminalScreen(touch){
    var screen=term&&term.element&&term.element.querySelector('.xterm-screen');
    var rect=screen&&screen.getBoundingClientRect();
    return !!(
      rect&&rect.width>0&&rect.height>0&&
      touch.clientX>=rect.left&&touch.clientX<=rect.right&&
      touch.clientY>=rect.top&&touch.clientY<=rect.bottom
    );
  }
  function terminalCell(touch){
    var screen=terminalScreenCell(touch);
    return {col:screen.col,row:term.buffer.active.viewportY+screen.row};
  }
  function selectTo(cell){
    if(!selectionStart)return;var range=terminalSelectionRange(selectionStart,cell,term.cols);
    term.select(range.column,range.row,range.length);
  }
  function handleMsg(ev){
    if(typeof ev.data!=='string'||ev.data.length>4194304)return;
    var msg;try{msg=JSON.parse(ev.data);}catch(_){return;}
    if(!msg||typeof msg!=='object')return;
    if(msg.type==='ready-probe'&&term)sendRN({type:'ready'});
    else if(msg.type==='session-snapshot'&&term)applySnapshot(msg.snapshot);
    else if(msg.type==='session-scrollback'&&term)applyScrollback(msg.data,msg.snapshot,msg.liveOutput);
    else if(msg.type==='write'&&typeof msg.data==='string'&&msg.data.length<=65536)enqueue(msg.data,msg.latencyTags);
    else if(msg.type==='connection-state'&&typeof msg.state==='string'&&(msg.detail===undefined||typeof msg.detail==='string'))setConnectionState(msg.state,msg.detail);
    else if(msg.type==='resize'&&term&&Number.isInteger(msg.cols)&&Number.isInteger(msg.rows)&&msg.cols>0&&msg.cols<=1000&&msg.rows>0&&msg.rows<=1000){
      term.resize(msg.cols,msg.rows);gridProposer.acknowledge(msg.cols,msg.rows);
      if(ownsSize)requestAnimationFrame(function(){scale=1;fitOwnedViewToWidth();});
      else scheduleViewportLayout();
    }
    else if(msg.type==='size-ownership')setSizeOwnership(msg.owned);
    else if(msg.type==='font-size'&&typeof msg.fontSize==='number')setFontSize(msg.fontSize);
    else if(msg.type==='font-delta'&&typeof msg.delta==='number')setFontSize(fontSize+msg.delta);
    else if(msg.type==='fit')fitView();
    else if(msg.type==='refresh'&&term){
      if(typeof term.clearTextureAtlas==='function')term.clearTextureAtlas();
      term.refresh(0,term.rows-1);
    }
      else if(msg.type==='zoom'&&typeof msg.delta==='number'){fitMode=false;applyScale(scale+msg.delta);}
    else if(msg.type==='selection-mode')setSelectionMode(msg.enabled);
    else if(msg.type==='copy-selection'&&term)sendRN({type:'copy',data:term.getSelection()});
    else if(msg.type==='paste'&&term&&typeof msg.data==='string'&&msg.data.length<=32768)term.paste(msg.data);
    else if(msg.type==='keyboard'&&typeof msg.visible==='boolean'&&term){
      if(msg.visible){focusTerminalInput(term);sendRN({type:'request-ime'});}
      else term.blur();
    }
    else if(msg.type==='get-latency-stats')emitLatStats();
  }
  function init(){
    document.getElementById('key-row').style.display='flex';
    var grid=readableGridForViewport();
    term=openTerminal(document.getElementById('tc'),grid.cols,grid.rows);
    scheduleViewportLayout();
    if(typeof window.__mobilyInspectTerminal==='function')window.__mobilyInspectTerminal(term);
    bindTerminalInput(term);
    new ResizeObserver(scheduleViewportLayout).observe(document.getElementById('viewport'));
    window.addEventListener('resize',scheduleViewportLayout);
    if(window.visualViewport)window.visualViewport.addEventListener('resize',scheduleViewportLayout);
    window.addEventListener('message',handleMsg);document.addEventListener('message',handleMsg);
    sendRN({type:'ready'});
  }
  document.getElementById('viewport').addEventListener('touchstart',function(e){
    if(selectionMode&&e.touches.length===1){selectionStart=terminalCell(e.touches[0]);selectTo(selectionStart);e.preventDefault();e.stopPropagation();}
    else if(e.touches.length===2){touchGesture=null;pinchDistance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);pinchScale=scale;}
    else if(!selectionMode&&e.touches.length===1){
      var touch=e.touches[0],viewport=document.getElementById('viewport');
      var mouse=isTouchInsideTerminalScreen(touch)&&isTerminalMouseReportingActive(mouseModeState);
      touchGesture={
        kind:'pending',startX:touch.clientX,startY:touch.clientY,lastX:touch.clientX,lastY:touch.clientY,
        left:viewport.scrollLeft,top:viewport.scrollTop,historyPixels:0,
        mouse:mouse,claimed:mouse
      };
      // Only a TUI mouse click owns the gesture from touchdown (cancelling
      // touchstart suppresses the synthetic click xterm would also report).
      // Pans and history swipes claim on the first move instead, and the
      // keyboard focus waits for the tap to resolve on touchend — every other
      // touch pattern must leave the gesture uncancelled and the IME closed.
      if(touchGesture.claimed){e.preventDefault();e.stopPropagation();}
    }
  },{passive:false,capture:true});
  document.getElementById('viewport').addEventListener('touchmove',function(e){
    if(selectionMode&&selectionStart&&e.touches.length===1){selectTo(terminalCell(e.touches[0]));e.preventDefault();}
    else if(e.touches.length===2&&pinchDistance>0){touchGesture=null;fitMode=false;var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);applyScale(pinchTerminalScale(pinchScale,pinchDistance,d));e.preventDefault();}
    else if(touchGesture&&e.touches.length===1){
      var touch=e.touches[0],viewport=document.getElementById('viewport');
      var dx=touch.clientX-touchGesture.startX,dy=touch.clientY-touchGesture.startY;
      if(touchGesture.kind==='pending'&&Math.hypot(dx,dy)>12){
        var horizontal=Math.abs(dx)>=Math.abs(dy);
        var overflowX=viewport.scrollWidth>viewport.clientWidth+1;
        var overflowY=viewport.scrollHeight>viewport.clientHeight+1;
        var viewingHistory=term&&term.buffer.active.viewportY<term.buffer.active.baseY;
        if((horizontal&&overflowX)||(!horizontal&&overflowY))touchGesture.kind='pan';
        else if(!horizontal&&viewingHistory)touchGesture.kind='history';
        else if(!horizontal&&touchGesture.mouse)touchGesture.kind='mouse-scroll';
        else if(!horizontal&&term&&term.buffer.active.baseY>0)touchGesture.kind='history';
        else touchGesture.kind='moved';
        if(touchGesture.kind==='pan'||touchGesture.kind==='history'||touchGesture.kind==='mouse-scroll')touchGesture.claimed=true;
      }
      if(touchGesture.kind==='pan'){
        viewport.scrollLeft=touchGesture.left-dx;
        viewport.scrollTop=touchGesture.top-dy;
      }else if((touchGesture.kind==='history'||touchGesture.kind==='mouse-scroll')&&term){
        var cell=cellMetrics();
        touchGesture.historyPixels+=touch.clientY-touchGesture.lastY;
        var lines=Math.trunc(-touchGesture.historyPixels/Math.max(1,cell.height));
        if(lines){
          if(touchGesture.kind==='history')term.scrollLines(lines);
          else{
            var screenCell=terminalScreenCell(touch);
            var wheel=sgrMouseWheelSequence(lines<0?'up':'down',screenCell.col,screenCell.row);
            sendInput(new Array(Math.abs(lines)+1).join(wheel));
          }
          touchGesture.historyPixels+=lines*cell.height;
        }
      }
      touchGesture.lastX=touch.clientX;touchGesture.lastY=touch.clientY;
      if(touchGesture.claimed||touchGesture.kind==='pan'||touchGesture.kind==='history'||touchGesture.kind==='mouse-scroll'){
        e.preventDefault();e.stopPropagation();
      }
    }
  },{passive:false,capture:true});
  document.getElementById('viewport').addEventListener('touchend',function(e){
    if(touchGesture&&touchGesture.kind==='pending'&&!e.touches.length&&!selectionMode&&term){
      var touch=e.changedTouches[0];
      if(touch&&Math.hypot(touch.clientX-touchGesture.startX,touch.clientY-touchGesture.startY)<=12){
        // The keyboard opens only here: a tap that never became a swipe, pan,
        // or pinch. Swipes and pans never touch the textarea, so the IME stays
        // closed for them. request-ime asks Android to serve the WebView and
        // show the soft keyboard after DOM focus alone.
        focusTerminalInput(term);
        sendRN({type:'request-ime'});
        if(touchGesture.mouse&&isTouchInsideTerminalScreen(touch)){
          var cell=terminalScreenCell(touch);
          sendInput(sgrMouseClickSequence(cell.col,cell.row));
          touchGesture.claimed=true;
        }
      }
    }
    if(touchGesture&&touchGesture.claimed){e.preventDefault();e.stopPropagation();}
    if(!e.touches.length){selectionStart=null;touchGesture=null;pinchDistance=0;}
  },{passive:false,capture:true});
  document.getElementById('viewport').addEventListener('touchcancel',function(){
    selectionStart=null;touchGesture=null;pinchDistance=0;
  },{passive:false,capture:true});
  document.getElementById('key-row').addEventListener('click',function(e){
    var btn=e.target.closest('.key-btn');if(!btn)return;
    var tog=btn.dataset.toggle;
    if(tog){setArmed(tog,tog==='ctrl'?!ctrlArmed:!altArmed);return;}
    var seqK=btn.dataset.seq;if(!seqK)return;
    var seq=KEY_SEQS[seqK]||seqK;
    sendInput(seq);
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>
</body>
</html>`;
}
import { MAX_SESSION_SCROLLBACK_CHARS } from '@mobily/shared';
