/**
 * Stalled mouse-enabled TUI fixture for issue 03 (queued mouse report leaks).
 *
 * Enters the alternate screen, enables SGR (1006) any-motion (1003) mouse
 * reporting, switches stdin to raw mode, and then blocks without ever reading
 * stdin — bytes written to the terminal pile up unread in the PTY input
 * queue, exactly like a wedged vim/htop on a real device.
 *
 * SIGTERM exits "cleanly" (DECRST mouse modes + leave alternate screen).
 * SIGKILL exits "abruptly" (no cleanup at all).
 *
 * The `pid=` marker lets the test signal this exact process.
 */
const ESC = '\u001b';

process.stdin.setRawMode(true);
process.stdout.write(
  `${ESC}[?1049h${ESC}[2J${ESC}[H${ESC}[?1003h${ESC}[?1006h${ESC}[?25l` +
    `STALLED MOUSE TUI pid=${process.pid}`,
);
process.on('SIGTERM', () => {
  process.stdout.write(`${ESC}[?1003l${ESC}[?1006l${ESC}[?1049l`);
  process.exit(0);
});
setInterval(() => undefined, 60_000);
