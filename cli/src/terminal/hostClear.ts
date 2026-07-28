/**
 * Clear the host workstation terminal (screen + scrollback) via ANSI.
 *
 * Uses the same sequence across Windows Terminal / PowerShell, macOS, and
 * Linux. Node enables VT processing on Windows stdout, so this works without
 * spawning `cls` / `clear` (which would fail or differ by shell).
 */
export const HOST_TERMINAL_CLEAR = '\u001b[2J\u001b[3J\u001b[H';

export interface HostTerminalWritable {
  write(data: string): unknown;
}

/** Erase the visible screen and scrollback, then move the cursor home. */
export function clearHostTerminal(output: HostTerminalWritable = process.stdout): void {
  output.write(HOST_TERMINAL_CLEAR);
}
