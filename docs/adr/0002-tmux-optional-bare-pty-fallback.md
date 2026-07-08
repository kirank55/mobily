# tmux is optional — bare PTY fallback on Windows

Session persistence wraps `tmux` when available (macOS, Linux, WSL) but falls back to a bare PTY managed by the CLI process when `tmux` is not present (native Windows without WSL).

With tmux: the session survives CLI crashes and supports scrollback replay via `capture-pane`. Without tmux: the session lives as long as the CLI process and scrollback replay comes from an in-process ring buffer.

This avoids forcing Windows users into WSL just to run the CLI, while still giving full tmux benefits on platforms where it's native.

**Consequences:**

- The session layer needs a `SessionBackend` abstraction with two implementations (`TmuxBackend`, `BareBackend`).
- Scrollback replay on the bare backend requires an in-process ring buffer (deferred to Phase 5 alongside tmux scrollback replay).
- CI tests both paths: tmux on Linux/macOS runners, bare on Windows runner.
