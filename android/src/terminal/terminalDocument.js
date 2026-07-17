export function clampTerminalScale(value) {
  return Math.max(0.2, Math.min(3, value));
}

export function fitTerminalScale(viewportWidth, viewportHeight, terminalWidth, terminalHeight) {
  return clampTerminalScale(
    Math.min(viewportWidth / terminalWidth, viewportHeight / terminalHeight),
  );
}

export function pinchTerminalScale(initialScale, initialDistance, currentDistance) {
  if (initialDistance <= 0) return clampTerminalScale(initialScale);
  return clampTerminalScale((initialScale * currentDistance) / initialDistance);
}

export function stripTerminalMouseControls(data) {
  return data.replace(/\x1b\[\?([0-9;]+)([hl])/g, function (_sequence, parameters, command) {
    var remaining = parameters.split(';').filter(function (parameter) {
      return ['1000', '1002', '1003', '1005', '1006', '1015'].indexOf(parameter) < 0;
    });
    return remaining.length ? '\x1b[?' + remaining.join(';') + command : '';
  });
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

/** Shared production terminal document used by the app and browser harness. */
export function buildTerminalDocument({ xtermCss, xtermJs, xtermFitJs, devBridgeJs = '' }) {
  const XTERM_CSS = xtermCss;
  const XTERM_JS = xtermJs;
  const XTERM_FIT_JS = xtermFitJs;
  const DEV_BRIDGE_JS = devBridgeJs;
  const VIEWPORT_HELPERS = [
    clampTerminalScale,
    fitTerminalScale,
    pinchTerminalScale,
    stripTerminalMouseControls,
    terminalSelectionRange,
  ]
    .map((helper) => helper.toString())
    .join('\n');
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
    #tc { position: absolute; left: 0; top: 0; padding: 4px; transform-origin: 0 0; }
    #tc .xterm { height: 100%; }
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
    <button class="key-btn" data-seq="HOME">Home</button>
    <button class="key-btn" data-seq="END">End</button>
    <button class="key-btn" data-seq="PGUP">PgUp</button>
    <button class="key-btn" data-seq="PGDN">PgDn</button>
  </div>
  <div id="viewport"><div id="stage"><div id="tc"></div></div></div>
</div>
<script nonce="mobily-terminal">${XTERM_JS}</script>
<script nonce="mobily-terminal">${XTERM_FIT_JS}</script>
<script nonce="mobily-terminal">${DEV_BRIDGE_JS}</script>
<script nonce="mobily-terminal">
${VIEWPORT_HELPERS}
(function(){
  'use strict';
  var KEY_SEQS={ESC:'\\x1b',TAB:'\\t',LEFT:'\\x1b[D',RIGHT:'\\x1b[C',UP:'\\x1b[A',DOWN:'\\x1b[B',HOME:'\\x1b[H',END:'\\x1b[F',PGUP:'\\x1b[5~',PGDN:'\\x1b[6~'};
  var pendingLat={},latSamples=[],ctrlArmed=false,altArmed=false;
  var outQ=[],rafPending=false,term=null,fitAddon=null;
  var scale=1,selectionMode=false,mouseCarry='',selectionStart=null,pinchDistance=0,pinchScale=1;

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
    if(!rafPending){rafPending=true;requestAnimationFrame(function(){
      rafPending=false;if(!outQ.length)return;
       var chunk=stripMouseModes(outQ.join(''));outQ=[];if(term)term.write(chunk);
    });}
  }
  function sendRN(msg){try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(msg));}catch(_){}}
  function sendInput(data){
    var values=new Uint32Array(1);crypto.getRandomValues(values);
    var tag='lat-'+values[0].toString(16).padStart(8,'0');
    pendingLat[tag]=performance.now();
    var pendingTags=Object.keys(pendingLat);if(pendingTags.length>256)delete pendingLat[pendingTags[0]];
    sendRN({type:'input',data:data,latencyTag:tag});
  }
  function stripMouseModes(data){
    var value=mouseCarry+data;mouseCarry='';
    var pending=value.match(/\x1b(?:\[|\[\?[0-9;]*)$/);
    if(pending){mouseCarry=pending[0];value=value.slice(0,-pending[0].length);}
    return stripTerminalMouseControls(value);
  }
  function terminalPixels(){
    var screen=term&&term.element&&term.element.querySelector('.xterm-screen');
    return {width:Math.max(1,(screen&&screen.offsetWidth||term.cols*8)+8),height:Math.max(1,(screen&&screen.offsetHeight||term.rows*16)+8)};
  }
  function applyScale(next){
    if(!term)return;scale=clampTerminalScale(next);
    var px=terminalPixels(),tc=document.getElementById('tc'),stage=document.getElementById('stage');
    tc.style.width=px.width+'px';tc.style.height=px.height+'px';tc.style.transform='scale('+scale+')';
    stage.style.width=Math.max(document.getElementById('viewport').clientWidth,px.width*scale)+'px';
    stage.style.height=Math.max(document.getElementById('viewport').clientHeight,px.height*scale)+'px';
  }
  function fitView(){
    if(!term)return;var viewport=document.getElementById('viewport'),px=terminalPixels();
    applyScale(fitTerminalScale(viewport.clientWidth,viewport.clientHeight,px.width,px.height));
    viewport.scrollLeft=0;viewport.scrollTop=0;
  }
  function setSelectionMode(enabled){
    selectionMode=!!enabled;document.body.classList.toggle('selecting',selectionMode);
    if(term){term.options.disableStdin=selectionMode;if(!selectionMode)term.clearSelection();}
  }
  function terminalCell(touch){
    var viewport=document.getElementById('viewport'),rect=viewport.getBoundingClientRect(),px=terminalPixels();
    var col=Math.max(0,Math.min(term.cols-1,Math.floor((touch.clientX-rect.left+viewport.scrollLeft)/scale/(px.width/term.cols))));
    var row=Math.max(0,Math.min(term.rows-1,Math.floor((touch.clientY-rect.top+viewport.scrollTop)/scale/(px.height/term.rows))));
    return {col:col,row:term.buffer.active.viewportY+row};
  }
  function selectTo(cell){
    if(!selectionStart)return;var range=terminalSelectionRange(selectionStart,cell,term.cols);
    term.select(range.column,range.row,range.length);
  }
  function handleMsg(ev){
    if(typeof ev.data!=='string'||ev.data.length>70000)return;
    var msg;try{msg=JSON.parse(ev.data);}catch(_){return;}
    if(!msg||typeof msg!=='object')return;
    if(msg.type==='write'&&typeof msg.data==='string'&&msg.data.length<=65536)enqueue(msg.data,msg.latencyTags);
    else if(msg.type==='resize'&&term&&Number.isInteger(msg.cols)&&Number.isInteger(msg.rows)&&msg.cols>0&&msg.cols<=1000&&msg.rows>0&&msg.rows<=1000){term.resize(msg.cols,msg.rows);requestAnimationFrame(fitView);}
    else if(msg.type==='fit')fitView();
    else if(msg.type==='zoom'&&typeof msg.delta==='number')applyScale(scale+msg.delta);
    else if(msg.type==='selection-mode')setSelectionMode(msg.enabled);
    else if(msg.type==='copy-selection'&&term)sendRN({type:'copy',data:term.getSelection()});
    else if(msg.type==='paste'&&term&&typeof msg.data==='string'&&msg.data.length<=32768)term.paste(msg.data);
    else if(msg.type==='get-latency-stats')emitLatStats();
  }
  function init(){
    term=new Terminal({allowProposedApi:true,cursorBlink:true,fontSize:14,cols:120,rows:40,
      fontFamily:"'Cascadia Code','JetBrains Mono','Fira Code','Courier New',monospace",
      theme:{background:'#1a1a1a',foreground:'#e6e6e6',cursor:'#e6e6e6',
        black:'#1a1a1a',red:'#da3633',green:'#2ea043',yellow:'#e3b341',
        blue:'#58a6ff',magenta:'#bc8cff',cyan:'#39c5cf',white:'#b1bac4',
        brightBlack:'#484f58',brightRed:'#f85149',brightGreen:'#56d364',
        brightYellow:'#e3b341',brightBlue:'#79c0ff',brightMagenta:'#d2a8ff',
        brightCyan:'#56d4dd',brightWhite:'#f0f6fc'},scrollback:5000,convertEol:false});
    fitAddon=new FitAddon.FitAddon();term.loadAddon(fitAddon);
    term.open(document.getElementById('tc'));requestAnimationFrame(fitView);
    document.getElementById('key-row').style.display='flex';
    term.onData(function(d){sendInput(d);});
    new ResizeObserver(function(){fitView();}).observe(document.getElementById('viewport'));
    window.addEventListener('message',handleMsg);document.addEventListener('message',handleMsg);
    sendRN({type:'ready'});
  }
  document.getElementById('viewport').addEventListener('touchstart',function(e){
    if(selectionMode&&e.touches.length===1){selectionStart=terminalCell(e.touches[0]);selectTo(selectionStart);e.preventDefault();}
    else if(e.touches.length===2){pinchDistance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);pinchScale=scale;}
  },{passive:false});
  document.getElementById('viewport').addEventListener('touchmove',function(e){
    if(selectionMode&&selectionStart&&e.touches.length===1){selectTo(terminalCell(e.touches[0]));e.preventDefault();}
    else if(e.touches.length===2&&pinchDistance>0){var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);applyScale(pinchTerminalScale(pinchScale,pinchDistance,d));e.preventDefault();}
  },{passive:false});
  document.getElementById('viewport').addEventListener('touchend',function(e){if(!e.touches.length){selectionStart=null;pinchDistance=0;}});
  document.getElementById('key-row').addEventListener('click',function(e){
    var btn=e.target.closest('.key-btn');if(!btn)return;
    var tog=btn.dataset.toggle;
    if(tog){setArmed(tog,tog==='ctrl'?!ctrlArmed:!altArmed);return;}
    var seqK=btn.dataset.seq;if(!seqK)return;
    var seq=KEY_SEQS[seqK]||seqK;
    if(ctrlArmed&&seq.length===1){seq=String.fromCharCode(seq.charCodeAt(0)&0x1f);setArmed('ctrl',false);}
    if(altArmed){seq='\\x1b'+seq;setArmed('alt',false);}
    sendInput(seq);
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>
</body>
</html>`;
}
