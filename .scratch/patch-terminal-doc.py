from pathlib import Path

p = Path('/home/kiran/code-wsl/mobily/android/src/terminal/terminalDocument.js')
text = p.read_text(encoding='utf-8')

old1 = """    else if(msg.type==='keyboard'&&typeof msg.visible==='boolean'&&term){
      if(msg.visible)focusTerminalInput(term);else term.blur();
    }"""
new1 = """    else if(msg.type==='keyboard'&&typeof msg.visible==='boolean'&&term){
      if(msg.visible){focusTerminalInput(term);sendRN({type:'request-ime'});}
      else term.blur();
    }"""

old2 = """        // The keyboard opens only here: a tap that never became a swipe, pan,
        // or pinch. Swipes and pans never touch the textarea, so the IME stays
        // closed for them.
        focusTerminalInput(term);"""
new2 = """        // The keyboard opens only here: a tap that never became a swipe, pan,
        // or pinch. Swipes and pans never touch the textarea, so the IME stays
        // closed for them. request-ime asks Android to serve the WebView and
        // show the soft keyboard after DOM focus alone.
        focusTerminalInput(term);
        sendRN({type:'request-ime'});"""

if old1 not in text:
    raise SystemExit('keyboard handler not found')
if old2 not in text:
    raise SystemExit('touchend focus not found')

p.write_text(text.replace(old1, new1).replace(old2, new2), encoding='utf-8', newline='\n')
print('updated terminalDocument.js')
