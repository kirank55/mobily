# tmux is optional — bare PTY fallback on Windows

Session persistence wraps `tmux` when available (macOS, Linux, WSL) but falls back to a bare PTY managed by the CLI process when `tmux` is not present (native Windows without WSL).

With tmux: the session survives CLI crashes and supports scrollback replay via `capture-pane`. Without tmux: the session lives as long as the CLI process and scrollback replay comes from an in-process ring buffer.

This avoids forcing Windows users into WSL just to run the CLI, while still giving full tmux benefits on platforms where it's native.

**Consequences:**

- The session layer uses a `SessionBackend` seam with two adapters (`TmuxBackend`, `BareBackend`).
- Both adapters expose bounded scrollback replay; the bare adapter uses an in-process ring buffer and tmux seeds the same buffer with `capture-pane` on startup.
- A deterministic working-directory-derived session name is reused across CLI restarts. `--session` overrides it, and `--kill-session` is the only Mobily command that terminates a persisted tmux session.
- Normal CLI shutdown detaches its tmux client. It never kills the shared session.
- The interactive CLI keeps pairing details visible until a phone authenticates, then mirrors the backend in the same terminal. A tmux-backed Session pins those details in a managed header pane; bare mode retains them only in terminal scrollback.
- Newly created tmux Sessions receive a session-local `[mobily]` Bash/Zsh prompt prefix. Persisted shell configuration and resumed Sessions are never rewritten.
- The tmux window uses the `largest` sizing policy. The workstation grid is authoritative and is broadcast to Android; phone fit, zoom, pan, and orientation changes are visual operations and do not reflow the PTY.
- Embedded workstation rendering suppresses terminal mouse tracking so the containing terminal emulator retains normal text selection semantics.
- CI tests both paths: tmux on Linux/macOS runners, bare on Windows runner.
