/**
 * src/terminal/TerminalView.tsx
 *
 * WebView-based xterm.js terminal.
 * Bridges output (RN → WebView via injectJavaScript) and input/resize
 * (WebView → RN via onMessage).
 *
 * rAF batching lives inside the generated inline document; we send raw data as fast
 * as the WS client delivers it and let the WebView's requestAnimationFrame
 * loop coalesce writes at display frequency.
 */

import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { XTERM_CSS, XTERM_FIT_JS, XTERM_JS } from './xtermAssets.generated';

export interface TerminalViewHandle {
  /** Write raw PTY data (ANSI/UTF-8) to the terminal. */
  write(data: string): void;
  /** Request the terminal to resize to the given dimensions. */
  resize(cols: number, rows: number): void;
  /** Query current P50/P95 latency stats (result arrives via onLatencyStats). */
  getLatencyStats(): void;
}

export interface TerminalViewProps {
  /** Called when the WebView terminal signals it is ready. */
  onReady?: () => void;
  /** Called when the user types or pastes in the terminal. */
  onInput?: (data: string) => void;
  /** Called when the terminal reports its dimensions (after fit). */
  onResize?: (cols: number, rows: number) => void;
  /** Called with latency stats (P50/P95 in ms). */
  onLatencyStats?: (n: number, p50: number, p95: number) => void;
}

// Build the terminal source object.
// We embed the terminal HTML and generated, pinned xterm assets inline so it
// works offline without granting the WebView filesystem or network access.
function getTerminalSource(): { uri: string } | { html: string; baseUrl: string } {
  // A synthetic HTTPS base gives the static document a non-file origin while
  // CSP blocks all network access.
  return {
    html: TERMINAL_HTML_CONTENT,
    baseUrl: 'https://localhost',
  };
}

export const TERMINAL_HTML_CONTENT = `<!DOCTYPE html>
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
    #tc { flex: 1; overflow: hidden; padding: 4px; }
    #tc .xterm { height: 100%; }
    #tc .xterm-screen { height: 100% !important; }
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
    <button class="key-btn" data-seq="HOME">Home</button>
    <button class="key-btn" data-seq="END">End</button>
    <button class="key-btn" data-seq="PGUP">PgUp</button>
    <button class="key-btn" data-seq="PGDN">PgDn</button>
  </div>
  <div id="tc"></div>
</div>
<script nonce="mobily-terminal">${XTERM_JS}</script>
<script nonce="mobily-terminal">${XTERM_FIT_JS}</script>
<script nonce="mobily-terminal">
(function(){
  'use strict';
  var KEY_SEQS={ESC:'\\x1b',TAB:'\\t',LEFT:'\\x1b[D',RIGHT:'\\x1b[C',UP:'\\x1b[A',DOWN:'\\x1b[B',HOME:'\\x1b[H',END:'\\x1b[F',PGUP:'\\x1b[5~',PGDN:'\\x1b[6~'};
  var pendingLat={},latSamples=[],ctrlArmed=false,altArmed=false;
  var outQ=[],rafPending=false,term=null,fitAddon=null;

  function setArmed(mod,v){
    if(mod==='ctrl'){ctrlArmed=v;var b=document.getElementById('ctrl-btn');if(b)b.classList.toggle('armed',v);}
    else{altArmed=v;var a=document.getElementById('alt-btn');if(a)a.classList.toggle('armed',v);}
  }
  function recordEcho(d){
    var re=/\\x1bP([0-9a-f]{8})\\x1b\\\\/g,m;
    while((m=re.exec(d))!==null){
      if(pendingLat[m[1]]!==undefined){latSamples.push(performance.now()-pendingLat[m[1]]);delete pendingLat[m[1]];}
    }
  }
  function emitLatStats(){
    if(!latSamples.length)return;
    var s=latSamples.slice().sort(function(a,b){return a-b;});
    var p50=s[Math.floor(s.length*.5)],p95=s[Math.floor(s.length*.95)];
    sendRN({type:'latency-stats',n:s.length,p50:Math.round(p50),p95:Math.round(p95)});
  }
  function enqueue(data){
    recordEcho(data);outQ.push(data);
    if(!rafPending){rafPending=true;requestAnimationFrame(function(){
      rafPending=false;if(!outQ.length)return;
      var chunk=outQ.join('');outQ=[];if(term)term.write(chunk);
    });}
  }
  function sendRN(msg){try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(msg));}catch(_){}}
  function handleMsg(ev){
    if(typeof ev.data!=='string'||ev.data.length>70000)return;
    var msg;try{msg=JSON.parse(ev.data);}catch(_){return;}
    if(!msg||typeof msg!=='object')return;
    if(msg.type==='write'&&typeof msg.data==='string'&&msg.data.length<=65536)enqueue(msg.data);
    else if(msg.type==='resize'&&term&&Number.isInteger(msg.cols)&&Number.isInteger(msg.rows)&&msg.cols>0&&msg.cols<=1000&&msg.rows>0&&msg.rows<=1000)term.resize(msg.cols,msg.rows);
    else if(msg.type==='get-latency-stats')emitLatStats();
  }
  function init(){
    term=new Terminal({allowProposedApi:true,cursorBlink:true,fontSize:14,
      fontFamily:"'Cascadia Code','JetBrains Mono','Fira Code','Courier New',monospace",
      theme:{background:'#1a1a1a',foreground:'#e6e6e6',cursor:'#e6e6e6',
        black:'#1a1a1a',red:'#da3633',green:'#2ea043',yellow:'#e3b341',
        blue:'#58a6ff',magenta:'#bc8cff',cyan:'#39c5cf',white:'#b1bac4',
        brightBlack:'#484f58',brightRed:'#f85149',brightGreen:'#56d364',
        brightYellow:'#e3b341',brightBlue:'#79c0ff',brightMagenta:'#d2a8ff',
        brightCyan:'#56d4dd',brightWhite:'#f0f6fc'},scrollback:5000,convertEol:false});
    fitAddon=new FitAddon.FitAddon();term.loadAddon(fitAddon);
    term.open(document.getElementById('tc'));fitAddon.fit();reportSize();
    document.getElementById('key-row').style.display='flex';
    term.onData(function(d){sendRN({type:'input',data:d});});
    new ResizeObserver(function(){if(fitAddon){fitAddon.fit();reportSize();}}).observe(document.getElementById('tc'));
    window.addEventListener('message',handleMsg);document.addEventListener('message',handleMsg);
    sendRN({type:'ready'});
  }
  function reportSize(){if(term)sendRN({type:'resize',cols:term.cols,rows:term.rows});}
  document.getElementById('key-row').addEventListener('click',function(e){
    var btn=e.target.closest('.key-btn');if(!btn)return;
    var tog=btn.dataset.toggle;
    if(tog){setArmed(tog,tog==='ctrl'?!ctrlArmed:!altArmed);return;}
    var seqK=btn.dataset.seq;if(!seqK)return;
    var seq=KEY_SEQS[seqK]||seqK;
    if(ctrlArmed&&seq.length===1){seq=String.fromCharCode(seq.charCodeAt(0)&0x1f);setArmed('ctrl',false);}
    if(altArmed){seq='\\x1b'+seq;setArmed('alt',false);}
    sendRN({type:'input',data:seq});
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>
</body>
</html>`;

const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { onReady, onInput, onResize, onLatencyStats },
  ref,
) {
  const webViewRef = useRef<WebView>(null);

  const postToWebView = useCallback((msg: Record<string, unknown>) => {
    const escaped = JSON.stringify(JSON.stringify(msg));
    const js = `(function(){try{window.dispatchEvent(new MessageEvent('message',{data:${escaped}}));}catch(e){}})();true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      write(data: string) {
        postToWebView({ type: 'write', data });
      },
      resize(cols: number, rows: number) {
        postToWebView({ type: 'resize', cols, rows });
      },
      getLatencyStats() {
        postToWebView({ type: 'get-latency-stats' });
      },
    }),
    [postToWebView],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (event.nativeEvent.data.length > 70_000) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      switch (msg['type']) {
        case 'ready':
          onReady?.();
          break;
        case 'input':
          if (typeof msg['data'] === 'string' && msg['data'].length <= 32_768) {
            onInput?.(msg['data']);
          }
          break;
        case 'resize':
          if (
            Number.isInteger(msg['cols']) &&
            Number.isInteger(msg['rows']) &&
            (msg['cols'] as number) > 0 &&
            (msg['cols'] as number) <= 1000 &&
            (msg['rows'] as number) > 0 &&
            (msg['rows'] as number) <= 1000
          ) {
            onResize?.(msg['cols'] as number, msg['rows'] as number);
          }
          break;
        case 'latency-stats':
          if (
            Number.isFinite(msg['n']) &&
            Number.isFinite(msg['p50']) &&
            Number.isFinite(msg['p95'])
          ) {
            onLatencyStats?.(msg['n'] as number, msg['p50'] as number, msg['p95'] as number);
          }
          break;
      }
    },
    [onReady, onInput, onResize, onLatencyStats],
  );

  const WebViewAny = WebView as unknown as React.ComponentType<Record<string, unknown>>;

  return (
    <View style={styles.container}>
      <WebViewAny
        ref={webViewRef}
        source={getTerminalSource()}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={false}
        originWhitelist={['https://localhost']}
        onShouldStartLoadWithRequest={(request: { url: string }) =>
          request.url === 'about:blank' ||
          request.url === 'https://localhost' ||
          request.url === 'https://localhost/' ||
          request.url.startsWith('https://localhost/#')
        }
        scrollEnabled={false}
        keyboardDisplayRequiresUserAction={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        thirdPartyCookiesEnabled={false}
      />
    </View>
  );
});

export default TerminalView;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
