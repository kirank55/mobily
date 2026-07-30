# tmux is optional — bare PTY fallback on Windows

> **Status note (2026-07):** Native Windows / PowerShell Station support is deferred.
> Current supported hosts are Linux (including Ubuntu and WSL) and macOS. The bare-PTY
> adapter remains the fallback whenever `tmux` is absent on those hosts.

Session persistence wraps `tmux` when available (macOS, Linux, WSL) but falls back to a bare PTY managed by the CLI process when `tmux` is not present (native Windows without WSL).

With tmux: the session survives CLI crashes and supports scrollback replay via `capture-pane`. Without tmux: the session lives as long as the CLI process and scrollback replay comes from an in-process ring buffer.

This avoids forcing Windows users into WSL just to run the CLI, while still giving full tmux benefits on platforms where it's native.

**Consequences:**

- The session layer uses a `SessionBackend` seam with two adapters (`TmuxBackend`, `BareBackend`).
- Both adapters expose bounded scrollback replay separately from visible-screen initialization. The bare adapter uses its in-process raw-output ring to reconstruct the current screen, while tmux captures only its attributed visible pane and cursor metadata for the initial canonical state.
- A deterministic working-directory-derived session name is reused across CLI restarts. `--session` overrides it, and `--kill-session` is the only Mobily command that terminates a persisted tmux session.
- Normal CLI shutdown detaches its tmux client. It never kills the shared session.
- With tmux, the CLI remains a pairing/control screen so its QR and connection details stay visible until a phone authenticates; it then auto-attaches this Station TTY into the Session (QR header pane above the shell). A printed `tmux attach-session` command remains available for an optional second terminal, and pairing details are also pinned in a managed header pane. Bare mode keeps the pairing details visible until a phone authenticates, then mirrors the backend in the same terminal.
- Newly created tmux Sessions receive a session-local `[mobily]` Bash/Zsh prompt prefix. Persisted shell configuration and resumed Sessions are never rewritten.
- The tmux window uses the `largest` sizing policy for native tmux clients. Mobily's shared Session grid follows Terminal Size Ownership with the Station as the default (and currently sole Android-used) owner; Android scales that grid visually rather than claiming resize authority.
- Mobily's tmux attachment advertises RGB support and disables the session-local tmux status row so colors and full-screen grid dimensions match the bare-PTY contract.
- Embedded workstation rendering suppresses terminal mouse tracking so the containing terminal emulator retains normal text selection semantics.
- Unit and integration tests cover both adapters; real tmux coverage runs when `tmux` is available (typically Linux CI). Main CI covers Linux `node-pty` spawn; the separate `pty-native` job validates macOS when CLI/shared paths change (native Windows / PowerShell Station support is deferred).
