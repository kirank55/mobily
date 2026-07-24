import { SessionPhaseTracker, type SessionPhaseTrackerOptions } from './phase.js';
export { cleanTerminalText } from './text.js';

export type { SessionPhaseTrackerOptions };

export interface AlertDetector {
  push(data: string): void;
  dispose(): void;
}

/** Converts bounded terminal text heuristics into deduplicated plain-text alerts. */
export class TerminalAlertDetector implements AlertDetector {
  private readonly tracker: SessionPhaseTracker;

  constructor(onAlert: (message: string) => void, options: SessionPhaseTrackerOptions = {}) {
    this.tracker = new SessionPhaseTracker({ onAlert, onPhase: () => undefined }, options);
  }

  push(data: string): void {
    this.tracker.push(data);
  }

  dispose(): void {
    this.tracker.dispose();
  }
}
