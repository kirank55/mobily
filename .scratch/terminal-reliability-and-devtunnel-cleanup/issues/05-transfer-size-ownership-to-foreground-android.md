# Transfer terminal-size ownership to foreground Android

Status: ready-for-agent

## What to build

Deliver the single-Android Terminal Size Owner path. Android explicitly claims size ownership when its terminal view becomes foregrounded and releases it when that view leaves, backgrounds, or disconnects. While Android owns the size, accepted dimensions resize the shared Session and the Station mirrors that grid. When ownership ends, the Station's current dimensions become authoritative again.

Connection lifetime alone must not imply terminal visibility. Brief lifecycle transitions should be debounced, and a lost client must not retain ownership forever.

## Acceptance criteria

- [ ] An authenticated foreground Android terminal can explicitly claim Terminal Size Ownership.
- [ ] A successful claim allows Android resize requests to change the shared Session grid.
- [ ] Station and Android viewers observe the same owner-selected dimensions and terminal output.
- [ ] Navigating away, backgrounding, disconnecting, or lease expiry releases Android ownership.
- [ ] Ownership release restores the Station's current terminal dimensions.
- [ ] A short lifecycle debounce prevents resize churn during brief foreground/background transitions.
- [ ] Reconnection requires a fresh ownership claim; an earlier connection cannot retain control.
- [ ] Real-PTY/WebSocket and Android lifecycle tests cover claim, resize, release, disconnect, expiry, and Station restoration.
- [ ] The terminal-session architecture decision is revised to replace workstation-only authority with Terminal Size Ownership.

## Blocked by

- [Issue 01](./01-show-idle-bare-session-on-android.md)
