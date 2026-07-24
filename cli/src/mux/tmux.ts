import type { IDisposable, PtyProcess, SpawnOptions } from '../pty/node-pty.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScrollbackBuffer } from './scrollback.js';
import { PtyOutputHub, reconstructAttributedVisibleAnsi } from './outputHub.js';
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
  private readonly hub: PtyOutputHub;
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
    this.hub = new PtyOutputHub(new ScrollbackBuffer(scrollbackBytes));

    const created = !sessionExists(sessionName, runtime);
    if (created) {
      runtime.execFile('tmux', ['new-session', '-d', '-s', sessionName, '-c', cwd]);
      installPromptPrefix(sessionName, runtime);
    }
    runtime.execFile('tmux', ['set-window-option', '-t', sessionName, 'window-size', 'largest']);
    runtime.execFile('tmux', ['set-option', '-t', sessionName, 'status', 'off']);
    try {
      this.hub.scrollback.append(
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
    this.dataSubscription = this.pty.onData((data) => this.hub.push(data));
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  onData(listener: (data: string) => void): IDisposable {
    return this.hub.onData(listener);
  }

  onExit(listener: Parameters<PtyProcess['onExit']>[0]): IDisposable {
    return this.pty.onExit(listener);
  }

  /**
   * One attributed ANSI reconstruction of tmux's current visible pane
   * (capture-pane -e + cursor metadata). Distinct from scrollback history.
   */
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
    return reconstructAttributedVisibleAnsi({
      contents,
      alternateOn: alternate === '1',
      cursorX: Number(cursorX),
      cursorY: Number(cursorY),
      cursorVisible: cursorVisible !== '0',
      cursorShape,
      cursorBlinking: cursorBlinking !== '0',
    });
  }

  readScrollback(maxLines?: number): string {
    return this.hub.scrollback.read(maxLines);
  }

  showPairingPanel(content: string, height: number): void {
    this.hidePairingPanel();
    this.panelDirectory = mkdtempSync(join(tmpdir(), 'mobily-qr-'));
    const panelFile = join(this.panelDirectory, 'panel.txt');
    const contentLines = Math.max(1, content.split('\n').length);
    const paneLines = Math.max(1, Math.min(height, contentLines));
    writeFileSync(panelFile, content, { encoding: 'utf8', mode: 0o600 });
    // Clear then print so unused pane rows do not linger as blank red space.
    const shellCommand = `printf '\\033[H\\033[J'; cat -- '${panelFile.replaceAll("'", "'\\''")}'; exec sleep infinity`;
    const pane = this.runtime
      .execFile('tmux', [
        'split-window',
        '-d',
        '-v',
        '-b',
        '-l',
        String(paneLines),
        '-P',
        '-F',
        '#{pane_id}',
        '-t',
        this.sessionName,
        shellCommand,
      ])
      .trim();
    if (pane) {
      this.runtime.execFile('tmux', ['set-option', '-p', '-t', pane, '@mobily_role', 'qr']);
      this.runtime.execFile('tmux', [
        'set-option',
        '-p',
        '-t',
        pane,
        '@mobily_panel_lines',
        String(paneLines),
      ]);
      // Keep the status pane from stealing keyboard focus; shell stays interactive.
      this.runtime.execFile('tmux', ['select-pane', '-t', pane, '-d']);
      this.runtime.execFile('tmux', ['resize-pane', '-t', pane, '-y', String(paneLines)]);
      installStatusPanelClampHook(this.sessionName, this.panelDirectory, this.runtime);
      selectShellPane(this.sessionName, this.runtime);
    }
  }

  hidePairingPanel(): void {
    removePairingPanel(this.sessionName, this.runtime);
    clearStatusPanelClampHooks(this.sessionName, this.runtime);
    if (this.panelDirectory) {
      rmSync(this.panelDirectory, { recursive: true, force: true });
      this.panelDirectory = undefined;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dataSubscription.dispose();
    this.hub.clear();
    this.pty.kill();
    clearStatusPanelClampHooks(this.sessionName, this.runtime);
    if (this.panelDirectory) rmSync(this.panelDirectory, { recursive: true, force: true });
  }
}

function installPromptPrefix(sessionName: string, runtime: SessionRuntime): void {
  const snippet = `if [ -n "$BASH_VERSION" ]; then case "$PS1" in '[mobily] '*) ;; *) PS1='[mobily] '"$PS1";; esac; elif [ -n "$ZSH_VERSION" ]; then case "$PROMPT" in '[mobily] '*) ;; *) PROMPT='[mobily] '"$PROMPT";; esac; else printf '[mobily] session\\n'; fi; clear`;
  runtime.execFile('tmux', ['send-keys', '-t', sessionName, '-l', snippet]);
  runtime.execFile('tmux', ['send-keys', '-t', sessionName, 'Enter']);
}

/**
 * Re-clamp the status/QR pane after clients attach or the window grows
 * (`window-size largest` otherwise expands the header into blank red space).
 */
export const CLAMP_STATUS_PANEL_SCRIPT = `#!/bin/sh
session="$1"
[ -n "$session" ] || exit 0
tmux list-panes -t "$session" -F '#{pane_id} #{@mobily_role} #{@mobily_panel_lines}' 2>/dev/null |
while read -r id role lines; do
  if [ "$role" = qr ] && [ -n "$lines" ]; then
    current=$(tmux display-message -p -t "$id" '#{pane_height}' 2>/dev/null || echo "")
    if [ "$current" != "$lines" ]; then
      tmux resize-pane -t "$id" -y "$lines"
    fi
  fi
done
`.replaceAll('\r\n', '\n');

/** Hooks that may re-clamp the status pane; exclude layout-changed to avoid error feedback loops. */
export const STATUS_PANEL_CLAMP_HOOK_EVENTS = ['client-resized', 'client-attached'] as const;

function installStatusPanelClampHook(
  sessionName: string,
  directory: string,
  runtime: SessionRuntime,
): void {
  const scriptPath = join(directory, 'clamp-status-panel.sh');
  writeFileSync(scriptPath, CLAMP_STATUS_PANEL_SCRIPT, { encoding: 'utf8', mode: 0o700 });
  // Invoke via `sh` so a missing +x/shebang cannot yield 127, and silence output so
  // failed hooks do not print into the attached workstation and corrupt the TTY.
  const quoted = scriptPath.replaceAll("'", "'\\''");
  const hook = `run-shell -b "sh '${quoted}' '#{session_name}' >/dev/null 2>&1"`;
  for (const event of STATUS_PANEL_CLAMP_HOOK_EVENTS) {
    runtime.execFile('tmux', ['set-hook', '-t', sessionName, event, hook]);
  }
}

function clearStatusPanelClampHooks(sessionName: string, runtime: SessionRuntime): void {
  for (const event of [...STATUS_PANEL_CLAMP_HOOK_EVENTS, 'window-layout-changed'] as const) {
    try {
      runtime.execFile('tmux', ['set-hook', '-t', sessionName, '-u', event]);
    } catch {
      // Hook may not exist yet.
    }
  }
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

/** Focus the interactive shell pane (any pane that is not the status/QR header). */
function selectShellPane(sessionName: string, runtime: SessionRuntime): void {
  const pane = findShellPane(sessionName, runtime);
  if (pane) runtime.execFile('tmux', ['select-pane', '-t', pane]);
}

/**
 * Clear the visible shell pane and its scrollback so a fresh workstation attach
 * does not show leftover output from the persisted tmux Session.
 */
export function clearShellPane(sessionName: string, runtime: SessionRuntime): boolean {
  const pane = findShellPane(sessionName, runtime);
  if (!pane) return false;
  try {
    runtime.execFile('tmux', ['send-keys', '-t', pane, '-l', 'clear']);
    runtime.execFile('tmux', ['send-keys', '-t', pane, 'Enter']);
    runtime.execFile('tmux', ['clear-history', '-t', pane]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render a compact status banner directly on the shell pane's TTY.
 *
 * Writing through the pane TTY keeps the banner in normal terminal content,
 * so `clear` dismisses it, without typing an implementation command into the
 * user's interactive shell. Enter redraws the prompt below the divider.
 */
export function printShellPaneLines(
  sessionName: string,
  lines: readonly string[],
  runtime: SessionRuntime,
): boolean {
  const pane = findShellPane(sessionName, runtime);
  if (!pane || lines.length === 0) return false;
  try {
    const [tty, widthText] = runtime
      .execFile('tmux', ['display-message', '-p', '-t', pane, '#{pane_tty}\t#{pane_width}'])
      .trim()
      .split('\t');
    if (!tty) return false;
    const width = Number.parseInt(widthText ?? '', 10);
    const dividerWidth = Number.isFinite(width) ? Math.max(1, width - 1) : 79;
    const divider = `\u001b[90m${'─'.repeat(dividerWidth)}\u001b[0m`;
    const banner = `\r\u001b[2K${lines.join('\r\n')}\r\n${divider}`;
    runtime.execFile('sh', ['-c', 'printf %s "$1" > "$2"', 'mobily', banner, tty]);
    runtime.execFile('tmux', ['send-keys', '-t', pane, 'Enter']);
    return true;
  } catch {
    return false;
  }
}

function findShellPane(sessionName: string, runtime: SessionRuntime): string | null {
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
    return null;
  }
  for (const line of panes.split('\n')) {
    const [pane, role] = line.trim().split(/\s+/, 2);
    if (pane && role !== 'qr') return pane;
  }
  return null;
}

/** Resize the QR header pane toward a vertical share of the window (e.g. 50). */
export function resizePairingPanel(
  sessionName: string,
  heightPercent: number,
  runtime: SessionRuntime,
): boolean {
  const percent = Math.min(90, Math.max(10, Math.round(heightPercent)));
  return forEachPairingPane(sessionName, runtime, (pane) => {
    runtime.execFile('tmux', ['resize-pane', '-t', pane, '-y', `${percent}%`]);
  });
}

/** Clamp the QR/status header pane to an exact row count (reduces blank red space). */
export function resizePairingPanelLines(
  sessionName: string,
  lines: number,
  runtime: SessionRuntime,
): boolean {
  const height = Math.max(1, Math.round(lines));
  return forEachPairingPane(sessionName, runtime, (pane) => {
    runtime.execFile('tmux', ['resize-pane', '-t', pane, '-y', String(height)]);
  });
}

function forEachPairingPane(
  sessionName: string,
  runtime: SessionRuntime,
  action: (pane: string) => void,
): boolean {
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
  let touched = false;
  for (const line of panes.split('\n')) {
    const [pane, role] = line.trim().split(/\s+/, 2);
    if (pane && role === 'qr') {
      action(pane);
      touched = true;
    }
  }
  return touched;
}

function sessionExists(name: string, runtime: SessionRuntime): boolean {
  try {
    runtime.execFile('tmux', ['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}
