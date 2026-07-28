/**
 * Post-auth workstation transition shared by every Session backend: after the
 * phone connects, the pairing screen is replaced by the Connected banner on
 * all operating systems (tmux shell pane, embedded bare-PTY console, Windows
 * Terminal / PowerShell included).
 */

/** ANSI clear of the visible screen and scrollback, then cursor home. Works in
 * POSIX terminals and Windows consoles (Node enables virtual-terminal
 * processing on TTY stdout). Same sequence as `mobily qr clear`. */
export const CLEAR_WORKSTATION_SCREEN = '\u001b[2J\u001b[3J\u001b[H';

/** Printed into the shell after phone auth; dismissed by a normal shell `clear`. */
export const CONNECTED_SUCCESS_LINE = 'Connected Successfully';

/** Help/exit hint shown with the success line. */
export const CONNECTED_HELP_LINE = ["'mobily -h' for help ·", "'mobily exit' to exit"].join(' ');

/** Success lines rendered as a dismissible shell banner after phone auth. */
export const CONNECTED_WORKSTATION_LINES = [CONNECTED_SUCCESS_LINE, CONNECTED_HELP_LINE] as const;

/** Joined form of {@link CONNECTED_WORKSTATION_LINES} (e.g. mux panel height fixtures). */
export const CONNECTED_WORKSTATION_PANEL = CONNECTED_WORKSTATION_LINES.join('\n');

export const CONNECTED_WORKSTATION_PANEL_HEIGHT = CONNECTED_WORKSTATION_LINES.length;

/** Clear + banner blob written to the hosting console before a bare Session mirror attaches. */
export const CONNECTED_WORKSTATION_INTRO = `${CLEAR_WORKSTATION_SCREEN}${CONNECTED_WORKSTATION_LINES.join('\r\n')}\r\n`;
