# tmux is optional — bare PTY fallback on Windows

Session persistence wraps `tmux` when available (macOS, Linux, WSL) but falls back to a bare PTY managed by the CLI process when `tmux` is not present (native Windows without WSL).

With tmux: the session survives CLI crashes and supports scrollback replay via `capture-pane`. Without tmux: the session lives as long as the CLI process and scrollback replay comes from an in-process ring buffer.

This avoids forcing Windows users into WSL just to run the CLI, while still giving full tmux benefits on platforms where it's native.

**Consequences:**

- The session layer uses a `SessionBackend` seam with two adapters (`TmuxBackend`, `BareBackend`).
- Both adapters expose bounded scrollback replay separately from visible-screen initialization. The bare adapter uses its in-process raw-output ring to reconstruct the current screen, while tmux captures only its attributed visible pane and cursor metadata for the initial canonical state.
- A deterministic working-directory-derived session name is reused across CLI restarts. `--session` overrides it, and `--kill-session` is the only Mobily command that terminates a persisted tmux session.
- Normal CLI shutdown detaches its tmux client. It never kills the shared session.
- With tmux, the CLI remains a pairing/control screen so its QR and connection details stay visible; it prints a command for attaching the Session from a second terminal and also pins the pairing details in a managed header pane. Bare mode keeps the pairing details visible until a phone authenticates, then mirrors the backend in the same terminal.
- Newly created tmux Sessions receive a session-local `[mobily]` Bash/Zsh prompt prefix. Persisted shell configuration and resumed Sessions are never rewritten.
- The tmux window uses the `largest` sizing policy for native tmux clients. Mobily's shared Session grid separately follows explicit Terminal Size Ownership: foreground Android may select it temporarily, and releasing ownership restores the Station's current dimensions.
- Mobily's tmux attachment advertises RGB support and disables the session-local tmux status row so colors and full-screen grid dimensions match the bare-PTY contract.
- Embedded workstation rendering suppresses terminal mouse tracking so the containing terminal emulator retains normal text selection semantics.
- CI tests both paths: tmux on Linux/macOS runners, bare on Windows runner.
