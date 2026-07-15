const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_DEDUPE_MS = 5 * 60_000;
const MAX_RAW_LINE = 8 * 1024;
const MAX_ALERT_MESSAGE = 512;

const PROMPT_PATTERN =
  /(?:\b(?:approve|confirm|allow|permission|continue|proceed)\b.*[?:]\s*$)|(?:\b(?:enter|provide|paste)\b.*\b(?:token|code|password)\b)|(?:\b(?:waiting for|needs|requires)\b.*\b(?:input|approval|confirmation)\b)/i;

export interface TerminalAlertDetectorOptions {
  idleTimeoutMs?: number;
  dedupeMs?: number;
}

export interface AlertDetector {
  push(data: string): void;
  dispose(): void;
}

/** Converts bounded terminal text heuristics into deduplicated plain-text alerts. */
export class TerminalAlertDetector implements AlertDetector {
  private readonly idleTimeoutMs: number;
  private readonly dedupeMs: number;
  private readonly emittedAt = new Map<string, number>();
  private rawLine = '';
  private lastMeaningfulLine = '';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly onAlert: (message: string) => void,
    options: TerminalAlertDetectorOptions = {},
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS;
  }

  push(data: string): void {
    if (this.disposed || data.length === 0) return;
    this.rawLine = (this.rawLine + data).slice(-MAX_RAW_LINE);
    const lines = this.rawLine.split(/\r\n|\r|\n/);
    this.rawLine = lines.pop() ?? '';
    for (const raw of lines) this.inspect(raw);
    this.inspect(this.rawLine);
    if (this.lastMeaningfulLine.length > 0) this.scheduleIdle();
  }

  dispose(): void {
    this.disposed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.rawLine = '';
    this.lastMeaningfulLine = '';
    this.emittedAt.clear();
  }

  private inspect(raw: string): void {
    const line = cleanTerminalText(raw).trim().slice(0, MAX_ALERT_MESSAGE);
    if (line.length === 0) return;
    this.lastMeaningfulLine = line;
    if (PROMPT_PATTERN.test(line)) this.emit(line);
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.lastMeaningfulLine) {
        this.emit(`Station idle: ${this.lastMeaningfulLine}`.slice(0, MAX_ALERT_MESSAGE));
      }
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private emit(message: string): void {
    const now = Date.now();
    const last = this.emittedAt.get(message);
    if (last !== undefined && now - last < this.dedupeMs) return;
    this.emittedAt.set(message, now);
    this.onAlert(message);
  }
}

export function cleanTerminalText(value: string): string {
  const withoutAnsi = stripAnsi(value);
  let result = '';
  for (const char of withoutAnsi) {
    const code = char.charCodeAt(0);
    if (code === 9 || code >= 32) result += char;
  }
  return result;
}

function stripAnsi(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) !== 27) {
      result += value[index];
      continue;
    }
    const introducer = value[index + 1];
    if (introducer === '[') {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) break;
        index++;
      }
    } else if (introducer === ']') {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code === 7) break;
        if (code === 27 && value[index + 1] === '\\') {
          index++;
          break;
        }
        index++;
      }
    }
  }
  return result;
}
