const ESC = '\u001b';

const frame = [
  `${ESC}[?1049h`,
  `${ESC}[2J${ESC}[H`,
  `${ESC}[1;38;2;18;171;239;48;5;17m OpenCode ${ESC}[0m`,
  `${ESC}[2;1H┌─ workspace ───────────────────────┐`,
  `${ESC}[3;1H│ model: ${ESC}[3;4mGPT-5${ESC}[0m`,
  `${ESC}[4;1HSTALE redraw target`,
  `${ESC}[2K${ESC}[4;1H${ESC}[33m│ ✓ READY redraw${ESC}[0m`,
  `${ESC}[5;1H│ plan 界 step`,
  `${ESC}[6;1H╰─› implement issue 2`,
  `${ESC}[?1002;25h`,
  `${ESC}[?25l${ESC}[1 q${ESC}[7;5H`,
].join('');

process.stdout.write(frame);
setInterval(() => undefined, 60_000);
