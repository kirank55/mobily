# tmux is optional — bare PTY fallback on Windows

Session persistence wraps `tmux` when available (macOS, Linux, WSL) but falls back to a bare PTY managed by the CLI process when `tmux` is not present (native Windows without WSL).

With tmux: the session survives CLI crashes and supports scrollback replay via `capture-pane`. Without tmux: the session lives as long as the CLI process and scrollback replay comes from an in-process ring buffer.

This avoids forcing Windows users into WSL just to run the CLI, while still giving full tmux benefits on platforms where it's native.

**Consequences:**

- The session layer uses a `SessionBackend` seam with two adapters (`TmuxBackend`, `BareBackend`).
- Both adapters expose bounded scrollback replay; the bare adapter uses an in-process ring buffer and tmux seeds the same buffer with `capture-pane` on startup.
- A deterministic working-directory-derived session name is reused across CLI restarts. `--session` overrides it, and `--kill-session` is the only Mobily command that terminates a persisted tmux session.
- Normal CLI shutdown detaches its tmux client. It never kills the shared session.
- With tmux, the CLI remains a pairing/control screen so its QR and connection details stay visible; it prints a command for attaching the Session from a second terminal. Bare mode mirrors the backend directly because it cannot add another client or survive CLI exit.
- The tmux window uses the `largest` sizing policy so an Android resize does not shrink a larger attached workstation terminal.
- CI tests both paths: tmux on Linux/macOS runners, bare on Windows runner.
