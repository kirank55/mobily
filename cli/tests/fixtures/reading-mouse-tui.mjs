/**
 * Responsive mouse-enabled TUI fixture for issue 03.
 *
 * Like stalled-mouse-tui.mjs (alternate screen, SGR 1006 + any-motion 1003
 * mouse reporting, raw stdin, SIGTERM = clean DECRST exit), but this one
 * actually reads stdin and reports every chunk as `TUI_GOT <json>` — letting
 * tests prove that clicks, wheel packets, and plain keys still reach an
 * active mouse-enabled TUI through the wire protocol.
 */
const ESC = '\u001b';

process.stdin.setRawMode(true);
process.stdout.write(
  `${ESC}[?1049h${ESC}[2J${ESC}[H${ESC}[?1003h${ESC}[?1006h${ESC}[?25l` +
    `READING MOUSE TUI pid=${process.pid}`,
);
process.stdin.on('data', (chunk) => {
  process.stdout.write(`\r\nTUI_GOT ${JSON.stringify(chunk.toString('utf8'))}`);
});
process.on('SIGTERM', () => {
  process.stdout.write(`${ESC}[?1003l${ESC}[?1006l${ESC}[?1049l`);
  process.exit(0);
});
setInterval(() => undefined, 60_000);
