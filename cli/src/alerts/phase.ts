import type { SessionPhase } from '@mobily/shared';
import type { AlertDetector } from './detector.js';
import { cleanTerminalText } from './text.js';

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_DEDUPE_MS = 5 * 60_000;
const MAX_RAW_LINE = 8 * 1024;
const MAX_ALERT_MESSAGE = 512;
const MAX_DETAIL = 160;

const PROMPT_PATTERN =
  /(?:\b(?:approve|confirm|allow|permission|continue|proceed)\b.*[?:]\s*$)|(?:\b(?:enter|provide|paste)\b.*\b(?:token|code|password)\b)|(?:\b(?:waiting for|needs|requires)\b.*\b(?:input|approval|confirmation)\b)|(?:\bdo you want to\b.*[?]\s*$)|(?:\b(?:y\/n|yes\/no)\b)/i;

const FINISHED_PATTERN =
  /(?:\b(?:build|tests?|task|job|run)\s+(?:completed|passed|finished|succeeded)\b)|(?:\b(?:all done|completed successfully|finished successfully)\b\.?\s*$)|(?:\bdone\.\s*$)/i;

const SHELL_PROMPT_PATTERN = /(?:[$#❯›➜]|PS>)\s*$/;

export interface SessionPhaseTrackerOptions {
  idleTimeoutMs?: number;
  dedupeMs?: number;
}

export interface SessionPhaseTrackerCallbacks {
  onPhase: (phase: SessionPhase, detail?: string) => void;
  onAlert: (message: string) => void;
}

/** Infers Working / Waiting / Finished / Idle from bounded PTY text heuristics. */
export class SessionPhaseTracker implements AlertDetector {
  private readonly idleTimeoutMs: number;
  private readonly dedupeMs: number;
  private readonly emittedAt = new Map<string, number>();
  private rawLine = '';
  private lastMeaningfulLine = '';
  private phase: SessionPhase | null = null;
  private sawWorking = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly callbacks: SessionPhaseTrackerCallbacks,
    options: SessionPhaseTrackerOptions = {},
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS;
  }

  push(data: string): void {
    if (this.disposed || data.length === 0) return;
    this.rawLine = (this.rawLine + data).slice(-MAX_RAW_LINE);
    const lines = this.rawLine.split(/\r\n|\r|\n/);
    this.rawLine = lines.pop() ?? '';
    for (const raw of lines) this.inspect(raw, true);
    this.inspect(this.rawLine, false);
    if (this.lastMeaningfulLine.length > 0) this.scheduleIdle();
  }

  dispose(): void {
    this.disposed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.rawLine = '';
    this.lastMeaningfulLine = '';
    this.phase = null;
    this.sawWorking = false;
    this.emittedAt.clear();
  }

  private inspect(raw: string, completeLine: boolean): void {
    const line = cleanTerminalText(raw).trim().slice(0, MAX_ALERT_MESSAGE);
    if (line.length === 0) return;
    this.lastMeaningfulLine = line;

    if (PROMPT_PATTERN.test(line)) {
      this.setPhase('waiting', line);
      this.emitAlert(line);
      return;
    }

    if (completeLine && FINISHED_PATTERN.test(line)) {
      this.setPhase('finished', line);
      return;
    }

    if (completeLine && this.sawWorking && SHELL_PROMPT_PATTERN.test(line)) {
      this.setPhase('finished', line);
      return;
    }

    this.sawWorking = true;
    this.setPhase('working', line);
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.lastMeaningfulLine) return;
      this.setPhase('idle', this.lastMeaningfulLine);
      this.emitAlert(`Station idle: ${this.lastMeaningfulLine}`.slice(0, MAX_ALERT_MESSAGE));
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private setPhase(phase: SessionPhase, detail: string): void {
    if (this.phase === phase) return;
    this.phase = phase;
    if (phase === 'working') this.sawWorking = true;
    if (phase === 'idle' || phase === 'finished') this.sawWorking = false;
    const bounded = detail.slice(0, MAX_DETAIL);
    this.callbacks.onPhase(phase, bounded.length > 0 ? bounded : undefined);
  }

  private emitAlert(message: string): void {
    const now = Date.now();
    for (const [previousMessage, emittedAt] of this.emittedAt) {
      if (now - emittedAt >= this.dedupeMs) this.emittedAt.delete(previousMessage);
    }
    const last = this.emittedAt.get(message);
    if (last !== undefined && now - last < this.dedupeMs) return;
    this.emittedAt.set(message, now);
    this.callbacks.onAlert(message);
  }
}
