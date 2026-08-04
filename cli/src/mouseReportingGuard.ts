/**
 * Queued mouse-report guard for the process boundary (issue 03 —
 * `.scratch/android-terminal-rash-bugs/issues/03-prevent-queued-mouse-report-leaks.md`).
 *
 * Mouse-enabled TUIs receive SGR mouse reports as ordinary PTY input. While a
 * TUI is stalled and not reading, those bytes pile up in the tty input queue;
 * when the TUI exits or is killed, the returning shell re-reads them as
 * literal input (`35;5;3M35;18;14M...` at the prompt, executed as commands).
 * Sender-side suppression alone cannot retract bytes already queued, so the
 * guard watches the output stream for the process boundary and, when mouse
 * reports were forwarded since the TUI took ownership, writes
 * {@link MOUSE_REPORTING_BOUNDARY_FLUSH} to the PTY. VINTR asks the line
 * discipline to discard pending input and interrupts the idle prompt — even
 * when the shell already consumed the packets, SIGINT aborts the polluted
 * readline line, so every arrival ordering ends at a clean, empty prompt.
 *
 * Arming mirrors the Android terminal's convention: DECSET 1000/1002/1003 in
 * the output stream means a mouse-enabled TUI owns the terminal, and the
 * Mobily-owned `[mobily] ` prompt prefix (installed by the tmux backend) is
 * the reliable process boundary when a TUI dies without DECRST. Backends whose
 * output never carries DECSET (tmux with `mouse off`) also never let clients
 * generate mouse reports, so the two conditions stay consistent.
 */
/** DEC private modes that enable click / drag / motion mouse reporting. */
const MOUSE_REPORTING_PARAMS = new Set(['1000', '1002', '1003']);

/** DEC private modes for the alternate screen (save/restore on exit). */
const ALTERNATE_SCREEN_PARAMS = new Set(['47', '1047', '1049']);

/** Mobily-owned shell prompt prefix: a reliable process boundary. */
export const MOBILY_SHELL_PROMPT = '[mobily] ';

/**
 * Written to the PTY when the boundary is crossed with mouse reports
 * potentially queued unread.
 */
export const MOUSE_REPORTING_BOUNDARY_FLUSH = '\x03';

/** How long post-boundary in-flight mouse packets are dropped. */
const DEFAULT_SUPPRESSION_WINDOW_MS = 1500;

const ESC = '\u001b';

/** A frame consisting solely of SGR (1006), X10/normal, or urxvt (1015) reports. */
const PURE_MOUSE_REPORT_INPUT = new RegExp(
  `^(?:${ESC}\\[<\\d+;\\d+;\\d+[Mm]|${ESC}\\[M[\\s\\S][\\s\\S][\\s\\S]|${ESC}\\[\\d+;\\d+;\\d+M)+$`,
);

/** DECSET/DECRST sequences and the Mobily prompt, stitched across chunks. */
const BOUNDARY_PATTERN = new RegExp(`${ESC}\\[\\?([0-9;]+)([hl])|\\[mobily\\] `, 'g');

export interface MouseReportingGuardOptions {
  /** Post-boundary stale-packet suppression window. @default 1500 */
  suppressionWindowMs?: number;
  /** Clock, injectable for tests. @default Date.now */
  now?: () => number;
}

export class MouseReportingGuard {
  private readonly suppressionWindowMs: number;
  private readonly now: () => number;
  private reportingArmed = false;
  private mouseInputPending = false;
  private suppressUntil = 0;
  private carry = '';
  /**
   * After `\x1b[?1049l` the saved main-screen prompt is replayed while the
   * exiting TUI still owns the tty — flushing there would deliver VINTR to the
   * TUI, not bash. Defer one flush until the next output chunk.
   */
  private flushOnNextOutput = false;

  constructor(options: MouseReportingGuardOptions = {}) {
    this.suppressionWindowMs = options.suppressionWindowMs ?? DEFAULT_SUPPRESSION_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Feed PTY output. Returns true exactly once per process boundary when the
   * shell prompt returns while mouse reports may still be queued unread — the
   * caller should then write {@link MOUSE_REPORTING_BOUNDARY_FLUSH} to the PTY.
   */
  trackOutput(data: string): boolean {
    if (typeof data !== 'string') return false;
    if (this.flushOnNextOutput && this.reportingArmed && this.mouseInputPending) {
      this.flushOnNextOutput = false;
      this.suppressUntil = this.now() + this.suppressionWindowMs;
      this.reportingArmed = false;
      this.mouseInputPending = false;
      return true;
    }
    if (data.length === 0) return false;
    const stream = this.carry + data;
    let flush = false;
    let ignoreNextMobilyPrompt = false;
    BOUNDARY_PATTERN.lastIndex = 0;
    let match;
    while ((match = BOUNDARY_PATTERN.exec(stream))) {
      if (match[0] === MOBILY_SHELL_PROMPT) {
        if (ignoreNextMobilyPrompt) {
          ignoreNextMobilyPrompt = false;
          continue;
        }
        if (this.reportingArmed && this.mouseInputPending) {
          flush = true;
          this.suppressUntil = this.now() + this.suppressionWindowMs;
        }
        this.reportingArmed = false;
        this.mouseInputPending = false;
        continue;
      }
      // DECRST (including 1049 alternate-screen exit) deliberately does not
      // disarm: packets queued while the TUI was stalled predate it, and only
      // the prompt proves the shell — not a still-running TUI — is reading.
      const enable = match[2] === 'h';
      const params = match[1].split(';');
      if (
        !enable &&
        this.reportingArmed &&
        this.mouseInputPending &&
        params.some((value) => ALTERNATE_SCREEN_PARAMS.has(value))
      ) {
        // The restored main-screen prompt replays in this chunk while the TUI
        // still owns the tty; defer the boundary flush until bash is reading.
        this.flushOnNextOutput = true;
        ignoreNextMobilyPrompt = true;
      }
      if (enable && params.some((value) => MOUSE_REPORTING_PARAMS.has(value))) {
        this.reportingArmed = true;
        // A TUI (re)taking mouse ownership ends stale-packet suppression.
        this.suppressUntil = 0;
        this.flushOnNextOutput = false;
      }
    }
    this.carry = stream.slice(-(MOBILY_SHELL_PROMPT.length - 1));
    return flush;
  }

  /**
   * Inspect input about to be written to the PTY. Pure mouse-report frames
   * mark the boundary as dirty while a TUI owns reporting; after the boundary
   * flush they are definitionally stale and dropped for the suppression
   * window. Everything else (and mouse frames with no recent boundary —
   * e.g. a client mid-TUI reattach) is forwarded unchanged.
   */
  trackInput(data: string): boolean {
    if (typeof data !== 'string' || !PURE_MOUSE_REPORT_INPUT.test(data)) return true;
    if (this.reportingArmed) {
      this.mouseInputPending = true;
      return true;
    }
    return this.now() >= this.suppressUntil;
  }
}
