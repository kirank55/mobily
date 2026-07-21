import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { SessionRuntime } from '../src/mux/runtime.js';
import {
  attachTmuxWorkstation,
  CONNECTED_HELP_LINE,
  CONNECTED_SUCCESS_DISMISS_MS,
  CONNECTED_SUCCESS_LINE,
  CONNECTED_WORKSTATION_PANEL,
  CONNECTED_WORKSTATION_PANEL_HEIGHT,
  DOUBLE_CTRL_C_EXIT_SCRIPT,
  EXIT_CONFIRM_MESSAGE,
  EXIT_CONFIRM_WINDOW_SECONDS,
  EXIT_KEY_SEQUENCE,
  scheduleConnectedPanelDismiss,
  shouldAttachTmuxWorkstation,
} from '../src/tmuxWorkstationAttach.js';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.exitCode = 1;
    this.emit('exit', 1, null);
    return true;
  }
}

function fakeRuntime(
  responses: Record<string, string> = {},
): {
  value: SessionRuntime;
  commands: Array<{ file: string; args: string[] }>;
} {
  const commands: Array<{ file: string; args: string[] }> = [];
  return {
    commands,
    value: {
      spawnPty: vi.fn(),
      canonicalize: (path) => path,
      execFile: vi.fn((file: string, args: string[]) => {
        commands.push({ file, args });
        const key = args[0] ?? '';
        if (key in responses) return responses[key]!;
        if (key === 'list-panes') return '%1 qr\n%2 \n';
        if (key === 'split-window') return '%42\n';
        return '';
      }),
    },
  };
}

describe('shouldAttachTmuxWorkstation()', () => {
  it('attaches only for tmux backends with a session name on an interactive TTY', () => {
    expect(
      shouldAttachTmuxWorkstation(
        { kind: 'tmux', sessionName: 'mobily-demo' },
        { isTTY: true },
        { isTTY: true },
      ),
    ).toBe(true);
    expect(
      shouldAttachTmuxWorkstation(
        { kind: 'bare', sessionName: null },
        { isTTY: true },
        { isTTY: true },
      ),
    ).toBe(false);
    expect(
      shouldAttachTmuxWorkstation(
        { kind: 'tmux', sessionName: 'mobily-demo' },
        { isTTY: false },
        { isTTY: true },
      ),
    ).toBe(false);
    expect(
      shouldAttachTmuxWorkstation(
        { kind: 'tmux', sessionName: null },
        { isTTY: true },
        { isTTY: true },
      ),
    ).toBe(false);
  });
});

describe('connected workstation panel', () => {
  it('shows Connected Successfully plus the help line until dismiss', () => {
    expect(CONNECTED_SUCCESS_LINE).toBe('Connected Successfully');
    expect(CONNECTED_HELP_LINE).toBe(
      'Run mobily -h for help. Press Ctrl+C twice to exit',
    );
    expect(CONNECTED_WORKSTATION_PANEL.split('\n')).toEqual([
      'Connected Successfully',
      'Run mobily -h for help. Press Ctrl+C twice to exit',
    ]);
    expect(CONNECTED_WORKSTATION_PANEL_HEIGHT).toBe(2);
    expect(CONNECTED_WORKSTATION_PANEL_HEIGHT).toBe(
      CONNECTED_WORKSTATION_PANEL.split('\n').length,
    );
  });

  it('hides the whole panel after 10 seconds by default', () => {
    vi.useFakeTimers();
    try {
      const hidePanel = vi.fn();
      const dismiss = scheduleConnectedPanelDismiss({ hidePanel });

      expect(CONNECTED_SUCCESS_DISMISS_MS).toBe(10_000);
      expect(hidePanel).not.toHaveBeenCalled();

      vi.advanceTimersByTime(CONNECTED_SUCCESS_DISMISS_MS - 1);
      expect(hidePanel).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(hidePanel).toHaveBeenCalledTimes(1);

      dismiss.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports a custom dismiss delay', () => {
    vi.useFakeTimers();
    try {
      const hidePanel = vi.fn();
      const dismiss = scheduleConnectedPanelDismiss({ hidePanel, delayMs: 500 });

      vi.advanceTimersByTime(499);
      expect(hidePanel).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(hidePanel).toHaveBeenCalledTimes(1);

      dismiss.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not dismiss after dispose cancels the timer', () => {
    vi.useFakeTimers();
    try {
      const hidePanel = vi.fn();
      const dismiss = scheduleConnectedPanelDismiss({ hidePanel });

      dismiss.dispose();
      vi.advanceTimersByTime(CONNECTED_SUCCESS_DISMISS_MS);
      expect(hidePanel).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('double Ctrl+C exit binding', () => {
  it('warns on the first press and detaches on the second within the confirm window', () => {
    expect(EXIT_KEY_SEQUENCE).toBe('C-c');
    expect(EXIT_CONFIRM_WINDOW_SECONDS).toBe(2);
    expect(EXIT_CONFIRM_MESSAGE).toBe('Press Ctrl+C again to exit');
    expect(DOUBLE_CTRL_C_EXIT_SCRIPT).toContain('display-message');
    expect(DOUBLE_CTRL_C_EXIT_SCRIPT).toContain('detach-client');
    expect(DOUBLE_CTRL_C_EXIT_SCRIPT).toContain(`-le ${EXIT_CONFIRM_WINDOW_SECONDS}`);
  });
});

describe('attachTmuxWorkstation()', () => {
  it('binds double Ctrl+C, spawns an inherited attach, and cleans up on dispose', () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as unknown as ChildProcess);
    const runtime = fakeRuntime();
    const onDetach = vi.fn();

    const attachment = attachTmuxWorkstation({
      sessionName: 'mobily-demo',
      attachCommand: 'tmux attach-session -t mobily-demo',
      env: {},
      spawn,
      runtime: runtime.value,
      onDetach,
    });

    expect(runtime.commands[0]).toEqual(
      expect.objectContaining({
        file: 'tmux',
        args: expect.arrayContaining(['bind-key', '-n', EXIT_KEY_SEQUENCE, 'run-shell']),
      }),
    );
    expect(runtime.commands).toEqual(
      expect.arrayContaining([
        {
          file: 'tmux',
          args: ['list-panes', '-t', 'mobily-demo', '-F', '#{pane_id} #{@mobily_role}'],
        },
        { file: 'tmux', args: ['resize-pane', '-t', '%1', '-y', '2'] },
        { file: 'tmux', args: ['send-keys', '-t', '%2', '-l', 'clear'] },
        { file: 'tmux', args: ['send-keys', '-t', '%2', 'Enter'] },
        { file: 'tmux', args: ['clear-history', '-t', '%2'] },
      ]),
    );
    expect(spawn).toHaveBeenCalledWith(
      'tmux',
      ['-T', 'RGB', 'attach-session', '-t', 'mobily-demo'],
      expect.objectContaining({ stdio: 'inherit', env: {} }),
    );

    child.exitCode = 0;
    child.emit('exit', 0, null);
    expect(onDetach).toHaveBeenCalledWith('Exiting Mobily');

    attachment.dispose();
    expect(child.killed).toBe(false);
    expect(runtime.commands).toEqual(
      expect.arrayContaining([
        { file: 'tmux', args: ['unbind-key', '-n', EXIT_KEY_SEQUENCE] },
        { file: 'tmux', args: ['set-environment', '-gu', 'MOBILY_EXIT_AT'] },
      ]),
    );
  });

  it('kills a still-running attach child when disposed during shutdown', () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as unknown as ChildProcess);
    const runtime = fakeRuntime();
    const onDetach = vi.fn();

    const attachment = attachTmuxWorkstation({
      sessionName: 'mobily-demo',
      attachCommand: 'tmux attach-session -t mobily-demo',
      env: {},
      spawn,
      runtime: runtime.value,
      onDetach,
    });

    attachment.dispose();
    expect(child.killed).toBe(true);
    expect(onDetach).not.toHaveBeenCalled();
  });

  it('splits the outer tmux window and clears TMUX for the inner attach', () => {
    const spawn = vi.fn();
    const runtime = fakeRuntime({ 'split-window': '%42\n' });

    const attachment = attachTmuxWorkstation({
      sessionName: 'mobily-demo',
      attachCommand: 'tmux attach-session -t mobily-demo',
      cwd: '/workspace',
      env: { TMUX: '/tmp/tmux-1000/default,123,0' },
      spawn,
      runtime: runtime.value,
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(runtime.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'tmux',
          args: expect.arrayContaining(['bind-key', '-n', EXIT_KEY_SEQUENCE, 'run-shell']),
        }),
        {
          file: 'tmux',
          args: [
            'split-window',
            '-v',
            '-p',
            '50',
            '-P',
            '-F',
            '#{pane_id}',
            '-c',
            '/workspace',
            "TMUX= exec tmux -T RGB attach-session -t 'mobily-demo'",
          ],
        },
      ]),
    );

    attachment.dispose();
    expect(runtime.commands).toEqual(
      expect.arrayContaining([
        { file: 'tmux', args: ['kill-pane', '-t', '%42'] },
        { file: 'tmux', args: ['unbind-key', '-n', EXIT_KEY_SEQUENCE] },
      ]),
    );
  });
});
