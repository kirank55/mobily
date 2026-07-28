/** Short workstation-oriented guidance printed by `mobily -h` / `mobily --help`. */
export function formatCliHelp(version: string): string {
  return [
    `mobily v${version}`,
    '',
    'Workstation session',
    '  mobily exit      Exit Mobily from an attached tmux terminal',
    '  mobily qr hide   Hide the status header pane',
    '  mobily qr clear  Hide the header and clear the terminal',
    '',
    'Start a Station',
    '  mobily                             Secure remote access (Dev Tunnels)',
    '  mobily --session <name> …          Stable tmux session name',
    '  mobily --kill-session <name>       End a persisted tmux session',
    '',
    'Device bindings',
    '  mobily --list-bindings',
    '  mobily --revoke-binding <binding-id>',
    '',
    'Other',
    '  mobily -h, --help',
    '  mobily --version',
    '  mobily --verbose',
    '  mobily --devtunnels-provider github|microsoft',
  ].join('\n');
}
