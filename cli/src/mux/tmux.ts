import type { IDisposable, PtyProcess, SpawnOptions } from '../pty/node-pty.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScrollbackBuffer } from './scrollback.js';
import { defaultSessionRuntime, type SessionRuntime } from './runtime.js';
import type { SessionBackend } from './types.js';

const INITIAL_CAPTURE_LINES = 500;

export interface TmuxBackendOptions extends SpawnOptions {
  cwd: string;
  sessionName: string;
  scrollbackBytes?: number;
}

export class TmuxBackend implements SessionBackend {
  readonly kind = 'tmux' as const;
  readonly sessionName: string;
  readonly attachCommand: string;

  private readonly pty: PtyProcess;
  private readonly scrollback: ScrollbackBuffer;
  private readonly listeners = new Set<(data: string) => void>();
  private readonly dataSubscription: IDisposable;
  private disposed = false;
  private panelDirectory?: string;

  constructor(
    options: TmuxBackendOptions,
    private readonly runtime: SessionRuntime = defaultSessionRuntime,
  ) {
    const { cwd, sessionName, scrollbackBytes, cols, rows, env, terminalName } = options;
    this.sessionName = sessionName;
    this.attachCommand = `tmux attach-session -t ${sessionName}`;
    this.scrollback = new ScrollbackBuffer(scrollbackBytes);

    const created = !sessionExists(sessionName, runtime);
    if (created) {
      runtime.execFile('tmux', ['new-session', '-d', '-s', sessionName, '-c', cwd]);
      installPromptPrefix(sessionName, runtime);
    }
    runtime.execFile('tmux', ['set-window-option', '-t', sessionName, 'window-size', 'largest']);
    runtime.execFile('tmux', ['set-option', '-t', sessionName, 'status', 'off']);
    try {
      this.scrollback.append(
        runtime.execFile('tmux', [
          'capture-pane',
          '-p',
          '-J',
          '-S',
          `-${INITIAL_CAPTURE_LINES}`,
          '-t',
          sessionName,
        ]),
      );
    } catch {
      // A newly-created empty pane may not have capture content yet.
    }

    this.pty = runtime.spawnPty({
      file: 'tmux',
      args: ['-T', 'RGB', 'attach-session', '-t', sessionName],
      cwd,
      cols,
      rows,
      env,
      terminalName,
    });
    this.dataSubscription = this.pty.onData((data) => {
      this.scrollback.append(data);
      for (const listener of this.listeners) listener(data);
    });
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  onData(listener: (data: string) => void): IDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  onExit(listener: Parameters<PtyProcess['onExit']>[0]): IDisposable {
    return this.pty.onExit(listener);
  }

  captureVisibleScreen(): string {
    const contents = this.runtime.execFile('tmux', [
      'capture-pane',
      '-p',
      '-e',
      '-N',
      '-t',
      this.sessionName,
    ]);
    const [alternate, cursorX, cursorY, cursorVisible, cursorShape, cursorBlinking] = this.runtime
      .execFile('tmux', [
        'display-message',
        '-p',
        '-t',
        this.sessionName,
        '#{alternate_on}\t#{cursor_x}\t#{cursor_y}\t#{cursor_flag}\t#{cursor_shape}\t#{cursor_blinking}',
      ])
      .replace(/\r?\n$/, '')
      .split('\t');
    const lines = contents.replace(/\r?\n$/, '').split(/\r?\n/);
    const screen = lines.map((line, row) => `\u001b[${row + 1};1H${line}`).join('');
    const activeScreen = alternate === '1' ? '\u001b[?1049h' : '\u001b[?1049l';
    const cursor = `\u001b[${Number(cursorY) + 1};${Number(cursorX) + 1}H`;
    const visibility = cursorVisible === '0' ? '\u001b[?25l' : '\u001b[?25h';
    const style = tmuxCursorStyleControl(cursorShape, cursorBlinking);
    return `${activeScreen}\u001b[2J\u001b[H${screen}\u001b[0m${style}${cursor}${visibility}`;
  }

  readScrollback(maxLines?: number): string {
    return this.scrollback.read(maxLines);
  }

  showPairingPanel(content: string, height: number): void {
    removePairingPanel(this.sessionName, this.runtime);
    this.panelDirectory = mkdtempSync(join(tmpdir(), 'mobily-qr-'));
    const panelFile = join(this.panelDirectory, 'panel.txt');
    writeFileSync(panelFile, content, { encoding: 'utf8', mode: 0o600 });
    const shellCommand = `cat -- '${panelFile.replaceAll("'", "'\\''")}'; exec sleep infinity`;
    const pane = this.runtime
      .execFile('tmux', [
        'split-window',
        '-d',
        '-v',
        '-b',
        '-l',
        String(Math.max(5, height)),
        '-P',
        '-F',
        '#{pane_id}',
        '-t',
        this.sessionName,
        shellCommand,
      ])
      .trim();
    if (pane) this.runtime.execFile('tmux', ['set-option', '-p', '-t', pane, '@mobily_role', 'qr']);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dataSubscription.dispose();
    this.listeners.clear();
    this.pty.kill();
    if (this.panelDirectory) rmSync(this.panelDirectory, { recursive: true, force: true });
  }
}

function tmuxCursorStyleControl(shape: string | undefined, blinking: string | undefined): string {
  const steady = blinking === '0';
  const code =
    shape === 'underline' ? (steady ? 4 : 3) : shape === 'bar' ? (steady ? 6 : 5) : steady ? 2 : 1;
  return `\u001b[${code} q`;
}

function installPromptPrefix(sessionName: string, runtime: SessionRuntime): void {
  const snippet = `if [ -n "$BASH_VERSION" ]; then case "$PS1" in '[mobily] '*) ;; *) PS1='[mobily] '"$PS1";; esac; elif [ -n "$ZSH_VERSION" ]; then case "$PROMPT" in '[mobily] '*) ;; *) PROMPT='[mobily] '"$PROMPT";; esac; else printf '[mobily] session\\n'; fi; clear`;
  runtime.execFile('tmux', ['send-keys', '-t', sessionName, '-l', snippet]);
  runtime.execFile('tmux', ['send-keys', '-t', sessionName, 'Enter']);
}

export function removePairingPanel(sessionName: string, runtime: SessionRuntime): boolean {
  let panes = '';
  try {
    panes = runtime.execFile('tmux', [
      'list-panes',
      '-t',
      sessionName,
      '-F',
      '#{pane_id} #{@mobily_role}',
    ]);
  } catch {
    return false;
  }
  let removed = false;
  for (const line of panes.split('\n')) {
    const [pane, role] = line.trim().split(/\s+/, 2);
    if (pane && role === 'qr') {
      runtime.execFile('tmux', ['kill-pane', '-t', pane]);
      removed = true;
    }
  }
  return removed;
}

function sessionExists(name: string, runtime: SessionRuntime): boolean {
  try {
    runtime.execFile('tmux', ['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}
