import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

const attachTmuxWorkstation = vi.hoisted(() => vi.fn(() => ({ dispose() {} })));

vi.mock('../src/workstation/tmuxAttach.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workstation/tmuxAttach.js')>();
  return {
    ...actual,
    attachTmuxWorkstation,
  };
});

import type { WorkstationInput, WorkstationOutput } from '../src/workstation/embedded.js';
import { beginWorkstationPresence, planWorkstationPresence } from '../src/workstation/presence.js';
import { Session } from '../src/session.js';
import type { SessionBackend } from '../src/sessionBackend/types.js';
import type { ExitEvent, IDisposable } from '../src/pty.js';

class RecordingBackend implements SessionBackend {
  readonly kind: 'bare' | 'tmux';
  readonly sessionName: string | null;
  readonly attachCommand: string | null;
  pairingPanels: Array<{ content: string; height: number }> = [];
  hidePairingPanelCalls = 0;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: ExitEvent) => void>();

  constructor(
    kind: 'bare' | 'tmux' = 'bare',
    sessionName: string | null = null,
    attachCommand: string | null = null,
  ) {
    this.kind = kind;
    this.sessionName = sessionName;
    this.attachCommand = attachCommand;
  }

  write(): void {}
  resetTerminal(): void {}
  resize(): void {}
  onData(listener: (data: string) => void): IDisposable {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }
  onExit(listener: (event: ExitEvent) => void): IDisposable {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }
  readScrollback(): string {
    return '';
  }
  captureVisibleScreen(): string {
    return '';
  }
  showPairingPanel(content: string, height: number): void {
    this.pairingPanels.push({ content, height });
  }
  hidePairingPanel(): void {
    this.hidePairingPanelCalls += 1;
  }
  dispose(): void {}
  emit(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }
}

/** Minimal open WebSocket stand-in for Session.attach without a real network. */
function fakeOpenSocket(): WebSocket {
  const socket = new EventEmitter() as WebSocket & EventEmitter;
  Object.assign(socket, {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
  });
  return socket;
}

describe('planWorkstationPresence', () => {
  it('embeds a bare backend on an interactive TTY', () => {
    const plan = planWorkstationPresence(
      { kind: 'bare', sessionName: null, attachCommand: null },
      { isTTY: true, setRawMode: () => undefined },
      { isTTY: true },
    );
    expect(plan.mode).toBe('embedded');
    expect(plan.logLines.join('\n')).toContain('embedded in this CLI');
  });

  it('auto-attaches tmux when the Station TTY is interactive', () => {
    const plan = planWorkstationPresence(
      {
        kind: 'tmux',
        sessionName: 'mobily-work',
        attachCommand: 'tmux attach-session -t mobily-work',
      },
      { isTTY: true },
      { isTTY: true },
    );
    expect(plan.mode).toBe('tmux-attach');
    expect(plan.logLines.join('\n')).toContain('attaches when the phone connects');
  });

  it('leaves pairing visible when tmux has no interactive TTY', () => {
    const plan = planWorkstationPresence(
      {
        kind: 'tmux',
        sessionName: 'mobily-work',
        attachCommand: 'tmux attach-session -t mobily-work',
      },
      { isTTY: false },
      { isTTY: false },
    );
    expect(plan.mode).toBe('none');
    expect(plan.logLines.join('\n')).toContain('open a second terminal');
  });
});

describe('beginWorkstationPresence', () => {
  beforeEach(() => {
    attachTmuxWorkstation.mockClear();
  });

  it('shows the pairing panel and attaches the embedded workstation on auth', async () => {
    const backend = new RecordingBackend('bare');
    const session = new Session({ backend, cols: 80, rows: 24 });
    const attachLocal = vi.spyOn(session, 'attachLocalTerminal').mockReturnValue({
      input() {},
      resize() {},
      dispose() {},
    });

    const presence = beginWorkstationPresence({
      session,
      backend,
      pairingPanel: 'PAIRING',
      pairingPanelHeight: 4,
      cwd: '/tmp',
      onEmbeddedShutdown: () => undefined,
      onTmuxDetach: () => undefined,
      input: {
        isTTY: true,
        setRawMode: () => undefined,
        setEncoding: () => undefined,
        resume: () => undefined,
        pause: () => undefined,
        on: () => undefined,
        off: () => undefined,
      },
      output: {
        isTTY: true,
        columns: 80,
        rows: 24,
        write: () => undefined,
        on: () => undefined,
        off: () => undefined,
      },
    });

    expect(presence.mode).toBe('embedded');
    expect(backend.pairingPanels).toEqual([{ content: 'PAIRING', height: 4 }]);
    expect(attachLocal).not.toHaveBeenCalled();

    session.attach(fakeOpenSocket());
    await vi.waitFor(() => expect(attachLocal).toHaveBeenCalledOnce());

    presence.dispose();
    session.dispose();
  });

  it('hides the pairing panel on tmux auth so success text is not a sticky pane', async () => {
    const backend = new RecordingBackend(
      'tmux',
      'mobily-work',
      'tmux attach-session -t mobily-work',
    );
    const session = new Session({ backend, cols: 80, rows: 24 });

    const presence = beginWorkstationPresence({
      session,
      backend,
      pairingPanel: 'PAIRING',
      pairingPanelHeight: 4,
      cwd: '/tmp',
      onEmbeddedShutdown: () => undefined,
      onTmuxDetach: () => undefined,
      input: { isTTY: true } as WorkstationInput,
      output: { isTTY: true } as WorkstationOutput,
    });

    expect(presence.mode).toBe('tmux-attach');
    expect(backend.pairingPanels).toEqual([{ content: 'PAIRING', height: 4 }]);
    expect(backend.hidePairingPanelCalls).toBe(0);

    session.attach(fakeOpenSocket());
    await vi.waitFor(() => expect(attachTmuxWorkstation).toHaveBeenCalledOnce());
    expect(backend.hidePairingPanelCalls).toBe(1);
    expect(backend.pairingPanels).toEqual([{ content: 'PAIRING', height: 4 }]);

    presence.dispose();
    session.dispose();
  });
});

describe('authenticated viewer attach ordering', () => {
  it('runs authenticated listeners before Session Snapshot so mutations are frozen', async () => {
    const backend = new RecordingBackend('bare');
    const session = new Session({ backend, cols: 40, rows: 12 });
    const order: string[] = [];
    const sent: unknown[] = [];

    session.onAuthenticatedClient(() => {
      order.push('authenticated');
      backend.emit('WORKSTATION_MUTATION\r\n');
    });

    const ws = fakeOpenSocket();
    (ws.send as ReturnType<typeof vi.fn>).mockImplementation((raw: string) => {
      const frame = JSON.parse(raw) as { type: string };
      sent.push(frame.type);
      if (frame.type === 'session-snapshot') order.push('snapshot');
    });

    session.attach(ws);
    await vi.waitFor(() => expect(order).toEqual(['authenticated', 'snapshot']));
    expect(sent.indexOf('terminal-size-owner')).toBeLessThan(sent.indexOf('session-snapshot'));
    expect(sent.indexOf('resize')).toBeLessThan(sent.indexOf('session-snapshot'));

    const snapshot = JSON.parse(
      (ws.send as ReturnType<typeof vi.fn>).mock.calls
        .map(([raw]) => raw as string)
        .find((raw) => raw.includes('"session-snapshot"'))!,
    ) as { grid: Array<Array<{ chars: string }>> };
    expect(
      snapshot.grid
        .flat()
        .map((cell) => cell.chars)
        .join(''),
    ).toContain('WORKSTATION_MUTATION');

    session.dispose();
  });
});
