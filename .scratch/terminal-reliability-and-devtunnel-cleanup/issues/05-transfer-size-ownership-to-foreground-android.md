# Transfer terminal-size ownership to foreground Android

Status: resolved

## What to build

Deliver the single-Android Terminal Size Owner path. Android explicitly claims size ownership when its terminal view becomes foregrounded and releases it when that view leaves, backgrounds, or disconnects. While Android owns the size, accepted dimensions resize the shared Session and the Station mirrors that grid. When ownership ends, the Station's current dimensions become authoritative again.

Connection lifetime alone must not imply terminal visibility. Brief lifecycle transitions should be debounced, and a lost client must not retain ownership forever.

## Acceptance criteria

- [x] An authenticated foreground Android terminal can explicitly claim Terminal Size Ownership.
- [x] A successful claim allows Android resize requests to change the shared Session grid.
- [x] Station and Android viewers observe the same owner-selected dimensions and terminal output.
- [x] Navigating away, backgrounding, disconnecting, or lease expiry releases Android ownership.
- [x] Ownership release restores the Station's current terminal dimensions.
- [x] A short lifecycle debounce prevents resize churn during brief foreground/background transitions.
- [x] Reconnection requires a fresh ownership claim; an earlier connection cannot retain control.
- [x] Real-PTY/WebSocket and Android lifecycle tests cover claim, resize, release, disconnect, expiry, and Station restoration.
- [x] The terminal-session architecture decision is revised to replace workstation-only authority with Terminal Size Ownership.

## Blocked by

- [Issue 01](./01-show-idle-bare-session-on-android.md)

## Answer

Protocol v6 adds explicit claim, release, and requester-specific owner-state
frames. The Session accepts resize frames only from the owning authenticated
socket, maintains the Station's latest dimensions while Android owns the grid,
and restores those dimensions on release, disconnect, or lease expiry.

Android now derives ownership from three independent signals: authenticated
connection readiness, terminal-route focus, and foreground AppState. It
debounces brief visibility changes, refreshes the bounded lease while active,
and makes a fresh claim after reconnect. Readable viewport-derived Android
dimensions remain the separately tracked Issue 06.

Coverage includes protocol validation, deterministic Android lifecycle tests,
WebSocket disconnect and expiry tests, and a real-PTY/authenticated-WebSocket
test proving shared dimensions, shared output, and Station restoration. ADR
0004 records ownership and initial-state ordering; ADR 0002 records the tmux
interaction.
