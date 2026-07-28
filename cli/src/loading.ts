/**
 * One-line terminal loading indicator. Animates on a TTY; prints a static
 * line otherwise. Call the returned function to clear/stop it.
 */

export interface LineLoadingOptions {
  readonly isTTY?: boolean;
  readonly write?: (chunk: string) => void;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** Start a loading line; the returned stop() clears it (TTY) or is a no-op. */
export function startLineLoading(
  message: string,
  options: LineLoadingOptions = {},
): () => void {
  const write = options.write ?? ((chunk: string) => process.stdout.write(chunk));
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  const schedule = options.setInterval ?? setInterval;
  const cancel = options.clearInterval ?? clearInterval;

  if (!isTTY) {
    write(`${message}\n`);
    return () => undefined;
  }

  let frame = 0;
  write(`${SPINNER_FRAMES[0]} ${message}`);
  const timer = schedule(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    write(`\r${SPINNER_FRAMES[frame]} ${message}`);
  }, 80);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    cancel(timer);
    write('\r\u001b[K');
  };
}
