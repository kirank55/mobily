/**
 * Station workstation presence: pairing panel + post-auth bare/tmux attach.
 *
 * Owns the ADR-0002 attach decision (backend kind + TTY) and coordinates with
 * Session Snapshot delivery via {@link Session.onAuthenticatedClient}, which
 * fires before snapshot capture so attach cannot rewrite the screen after it.
 */

import type { Session } from './session.js';
import type { SessionBackend } from './mux/types.js';
import type { IDisposable } from './pty/node-pty.js';
import {
  attachWorkstationTerminal,
  shouldEmbedWorkstationTerminal,
  type WorkstationInput,
  type WorkstationOutput,
  type WorkstationShutdownCause,
} from './workstationTerminal.js';
import { attachTmuxWorkstation, shouldAttachTmuxWorkstation } from './tmuxWorkstationAttach.js';

export type WorkstationPresenceMode = 'embedded' | 'tmux-attach' | 'none';

export interface WorkstationPresencePlan {
  readonly mode: WorkstationPresenceMode;
  readonly logLines: string[];
}

export interface BeginWorkstationPresenceOptions {
  readonly session: Session;
  readonly backend: SessionBackend;
  readonly pairingPanel: string;
  readonly pairingPanelHeight: number;
  readonly cwd: string;
  readonly onEmbeddedShutdown: (reason: WorkstationShutdownCause) => void;
  readonly onTmuxDetach: (message: string) => void;
  readonly log?: (line: string) => void;
  readonly input?: WorkstationInput;
  readonly output?: WorkstationOutput;
}

export interface WorkstationPresenceHandle extends IDisposable {
  readonly mode: WorkstationPresenceMode;
}

/** Decide how this Station TTY participates after a phone authenticates. */
export function planWorkstationPresence(
  backend: Pick<SessionBackend, 'kind' | 'sessionName' | 'attachCommand'>,
  input: Pick<WorkstationInput, 'isTTY' | 'setRawMode'> = process.stdin,
  output: Pick<WorkstationOutput, 'isTTY'> = process.stdout,
): WorkstationPresencePlan {
  if (shouldEmbedWorkstationTerminal(backend, input, output)) {
    const logLines = [
      'Workstation:  embedded in this CLI below',
      ...(backend.attachCommand ? [`Additional:   ${backend.attachCommand}`] : []),
    ];
    return { mode: 'embedded', logLines };
  }
  if (backend.kind === 'tmux') {
    if (shouldAttachTmuxWorkstation(backend, input, output)) {
      return {
        mode: 'tmux-attach',
        logLines: [
          'Workstation:  this terminal attaches when the phone connects',
          `Attach:       ${backend.attachCommand}`,
        ],
      };
    }
    return {
      mode: 'none',
      logLines: [
        'Workstation:  open a second terminal (pairing QR stays visible here)',
        `Attach:       ${backend.attachCommand}`,
      ],
    };
  }
  return {
    mode: 'none',
    logLines: [
      'Workstation:  embedded terminal unavailable (interactive TTY required)',
      ...(backend.attachCommand
        ? [`Attach:       ${backend.attachCommand}`]
        : ['Fallback:     unavailable in bare mode; the session ends when the CLI exits']),
    ],
  };
}

/**
 * Show the pairing panel and, when the mode requires it, attach the local
 * workstation exactly once on the first authenticated viewer (pre-snapshot).
 */
export function beginWorkstationPresence(
  options: BeginWorkstationPresenceOptions,
): WorkstationPresenceHandle {
  const plan = planWorkstationPresence(
    options.backend,
    options.input ?? process.stdin,
    options.output ?? process.stdout,
  );
  options.backend.showPairingPanel?.(options.pairingPanel, options.pairingPanelHeight);

  if (plan.mode === 'none') {
    return { mode: plan.mode, dispose() {} };
  }

  let started = false;
  let workstation: IDisposable | null = null;
  const start = (): void => {
    if (started) return;
    started = true;
    workstation =
      plan.mode === 'embedded'
        ? attachWorkstationTerminal(options.session, {
            input: options.input,
            output: options.output,
            onShutdown: options.onEmbeddedShutdown,
          })
        : startTmuxAttach(options);
  };

  const authSubscription = options.session.onAuthenticatedClient(start);
  return {
    mode: plan.mode,
    dispose(): void {
      authSubscription.dispose();
      workstation?.dispose();
      workstation = null;
    },
  };
}

function startTmuxAttach(options: BeginWorkstationPresenceOptions): IDisposable {
  const sessionName = options.backend.sessionName;
  const attachCommand = options.backend.attachCommand;
  if (!sessionName || !attachCommand) {
    throw new Error('tmux workstation attach requires sessionName and attachCommand');
  }
  options.log?.('Phone connected — attaching workstation…');
  // Drop the sticky QR/status pane; success lines are printed into the shell
  // so a normal `clear` dismisses them.
  options.backend.hidePairingPanel?.();
  return attachTmuxWorkstation({
    sessionName,
    attachCommand,
    cwd: options.cwd,
    onDetach: options.onTmuxDetach,
  });
}
