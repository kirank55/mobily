import { formatCliError } from './errors.js';

export const CLI_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface CliLifecycleRuntime {
  onSignal(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  offSignal(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  setDeadline(listener: () => void, delayMs: number): unknown;
  clearDeadline(deadline: unknown): void;
  write(message: string): void;
  writeError(message: string): void;
  exit(code: number): void;
}

export interface CliCleanup {
  readonly temporaryTunnel: boolean;
  stopNewWork(): void;
  run(signal: AbortSignal): Promise<void>;
}

interface ShutdownRequest {
  readonly reason: string;
  readonly exitCode: number;
}

type LifecycleState = 'running' | 'cleaning' | 'exited';

/**
 * Coordinates every CLI exit through one bounded, idempotent cleanup path.
 * The runtime seam keeps signal delivery, time, output, and exit deterministic
 * in tests.
 */
export class CliLifecycle {
  private state: LifecycleState = 'running';
  private cleanup: CliCleanup | undefined;
  private deadline: unknown;
  private abortController: AbortController | undefined;
  private firstRequest: ShutdownRequest | undefined;
  private listenersInstalled = false;

  private readonly onSigint = (): void => {
    void this.requestShutdown('SIGINT received', 130);
  };

  private readonly onSigterm = (): void => {
    void this.requestShutdown('SIGTERM received', 143);
  };

  constructor(
    private readonly runtime: CliLifecycleRuntime,
    private readonly shutdownTimeoutMs = CLI_SHUTDOWN_TIMEOUT_MS,
  ) {}

  installSignalHandlers(): void {
    if (this.listenersInstalled) return;
    this.listenersInstalled = true;
    this.runtime.onSignal('SIGINT', this.onSigint);
    this.runtime.onSignal('SIGTERM', this.onSigterm);
  }

  setCleanup(cleanup: CliCleanup): void {
    if (this.cleanup) throw new Error('CLI cleanup has already been configured');
    this.cleanup = cleanup;
  }

  async requestShutdown(reason: string, exitCode = 0): Promise<void> {
    if (this.state === 'exited') return;
    if (this.state === 'cleaning') {
      this.forceExit(
        this.cleanup?.temporaryTunnel
          ? 'Shutdown forced; Temporary Tunnel recovery will resume on the next run.'
          : 'Shutdown forced.',
      );
      return;
    }

    this.state = 'cleaning';
    this.firstRequest = { reason, exitCode };
    this.runtime.write(`${reason}; shutting down…\n`);

    try {
      this.cleanup?.stopNewWork();
    } catch (error) {
      this.runtime.writeError(`${formatCliError(error, false)}\n`);
    }

    if (this.cleanup?.temporaryTunnel) {
      this.runtime.write('Cleaning up Temporary Tunnel…\n');
    }

    this.abortController = new AbortController();
    this.deadline = this.runtime.setDeadline(() => {
      this.forceExit(
        this.cleanup?.temporaryTunnel
          ? 'Temporary Tunnel cleanup timed out after 10 seconds; recovery will run on the next start.'
          : 'Shutdown timed out after 10 seconds; forcing exit.',
      );
    }, this.shutdownTimeoutMs);

    try {
      await (this.cleanup?.run(this.abortController.signal) ?? Promise.resolve());
      this.finish(exitCode);
    } catch (error) {
      if (this.hasExited()) return;
      const prefix = this.cleanup?.temporaryTunnel
        ? 'Temporary Tunnel cleanup failed'
        : 'Shutdown cleanup failed';
      const recovery = this.cleanup?.temporaryTunnel ? ' Recovery will run on the next start.' : '';
      this.runtime.writeError(`${prefix}: ${formatCliError(error, false)}${recovery}\n`);
      this.finish(exitCode === 0 ? 1 : exitCode);
    }
  }

  async fail(error: unknown, verbose: boolean): Promise<void> {
    this.runtime.writeError(`${formatCliError(error, verbose)}\n`);
    await this.requestShutdown('Mobily failed', 1);
  }

  private forceExit(message: string): void {
    if (this.state === 'exited') return;
    this.abortController?.abort();
    this.runtime.writeError(`${message}\n`);
    this.finish(this.firstRequest?.exitCode ?? 1);
  }

  private hasExited(): boolean {
    return this.state === 'exited';
  }

  private finish(exitCode: number): void {
    if (this.state === 'exited') return;
    this.state = 'exited';
    if (this.deadline !== undefined) {
      this.runtime.clearDeadline(this.deadline);
      this.deadline = undefined;
    }
    this.removeSignalHandlers();
    this.runtime.exit(exitCode);
  }

  private removeSignalHandlers(): void {
    if (!this.listenersInstalled) return;
    this.listenersInstalled = false;
    this.runtime.offSignal('SIGINT', this.onSigint);
    this.runtime.offSignal('SIGTERM', this.onSigterm);
  }
}

export function createNodeCliLifecycleRuntime(): CliLifecycleRuntime {
  return {
    onSignal: (signal, listener) => process.on(signal, listener),
    offSignal: (signal, listener) => process.off(signal, listener),
    setDeadline: (listener, delayMs) => setTimeout(listener, delayMs),
    clearDeadline: (deadline) => clearTimeout(deadline as NodeJS.Timeout),
    write: (message) => process.stdout.write(message),
    writeError: (message) => process.stderr.write(message),
    exit: (code) => process.exit(code),
  };
}
