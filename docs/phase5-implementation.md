# Phase 5 — Polish & Backgrounding: Implementation Contract

> Direct-to-`main` implementation of Phase 5 from `docs/plan.md` and
> `docs/tasks.md`. Every checkpoint must preserve the existing terminal, auth,
> Git RPC, and multi-Station behavior.

## Scope

Phase 5 adds three capabilities:

1. A shared named tmux session when tmux is available, with a bare PTY fallback.
2. Bounded scrollback replay and terminal-output alerts over protocol version 3.
3. An Android foreground service whose ongoing notification reports connection
   state, the latest terminal line, and agent alerts.

## Session backend seam

`cli/src/mux/types.ts` owns the `SessionBackend` interface. `Session` may only
depend on this interface:

```ts
interface SessionBackend {
  readonly kind: 'bare' | 'tmux';
  readonly sessionName: string | null;
  readonly attachCommand: string | null;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): IDisposable;
  onExit(listener: (event: ExitEvent) => void): IDisposable;
  readScrollback(maxLines?: number): string;
  dispose(): void;
}
```

Backend construction, tmux process invocation, scrollback storage, and cleanup
stay behind this seam. `Session` no longer exposes a concrete PTY.

### Bare backend

`BareBackend` wraps the current node-pty behavior. It keeps a bounded 512 KiB
ring buffer and returns at most the requested number of trailing logical lines.
Disposal terminates the PTY, so bare sessions survive network disconnects but
not CLI process exit.

### Tmux backend

`TmuxBackend` uses fixed `tmux` executable arguments without a shell. It:

- creates a detached session when the name does not exist;
- reuses the existing session otherwise;
- seeds its bounded replay buffer from `capture-pane -p -J` before attaching;
- attaches Mobily through its own PTY so Android and workstation clients share
  input and output;
- sets the window sizing policy to `largest`, preventing a narrow phone from
  shrinking a larger workstation client;
- detaches Mobily on disposal without killing the tmux session.

The CLI prints the exact `tmux attach-session -t <name>` workstation command.
An explicit management command terminates a stale named session; ordinary
Ctrl+C never terminates it.

### Detection and naming

The factory selects tmux only when `tmux -V` succeeds. All other cases fall
back to bare mode with a clear limitation message.

`--session <name>` accepts `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. Without it, the
name is `mobily-<cwd-slug>-<cwd-hash>`, where the hash is derived from the
canonical working directory. The stable name makes a CLI restart reattach the
same tmux session without conflating repositories with equal basenames.

`--kill-session <name>` explicitly removes a stale Mobily tmux session and
exits. It never runs as part of normal shutdown.

## Replay ordering

Each backend records terminal output before notifying listeners. On an
authenticated WebSocket attach, `Session` sends one replay `output` frame before
the socket joins live broadcasts. Because replay reads synchronously from the
backend buffer on the Node.js event loop, live backend output cannot interleave
between the snapshot and subscriber registration.

Replay defaults to 500 lines and is bounded by both line count and the backend's
512 KiB storage limit. Empty replay emits no frame.

## Alert protocol

Protocol version 3 adds:

```ts
type AlertFrame = {
  type: 'alert';
  message: string;
};
```

Messages are non-empty and capped at 512 UTF-16 code units. Alert frames are
CLI-to-client only and are accepted only after authentication.

The CLI alert detector consumes terminal output, strips ANSI control sequences,
and retains only a bounded current line. It emits:

- prompt alerts for explicit approval, confirmation, token, or input requests;
- an idle alert after configurable inactivity following meaningful output.

Repeated identical alerts are suppressed for five minutes. Timers and buffered
text are released when the Session is disposed. Heuristics never execute or
interpret terminal content as commands.

## Android foreground service

A local Expo module owns an Android API 26+ foreground service. Its TypeScript
interface is limited to:

```ts
requestNotificationPermission(): Promise<boolean>;
start(stationName: string): Promise<void>;
update(connectionState: string, lastLine: string, alert?: string): Promise<void>;
stop(): Promise<void>;
```

The service creates a low-importance notification channel and an ongoing
notification that opens Mobily when tapped. It starts when a Station connection
starts, updates on connection state/output/alerts, and stops only on deliberate
disconnect or provider teardown. The notification contains bounded plain text;
terminal escape sequences are removed.

Keeping the process in foreground-service priority allows the existing
WebSocket client to remain active in the background. On resume, the existing
connection state machine re-authenticates when needed, then receives backend
scrollback before live output.

## Public TDD seams

Tests exercise behavior through the approved public seams:

- `SessionBackend` plus the backend factory;
- authenticated `Session` WebSocket behavior;
- shared protocol encode/decode;
- the alert detector;
- Android `WsClient` callbacks;
- the foreground-notification TypeScript module.

Tmux integration tests use a uniquely named real tmux session when tmux is
available and always clean it up explicitly. Windows/fallback tests use the bare
adapter without requiring tmux.

## Verification gates

Automated gates:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `pnpm android:prebuild`
- focused Kotlin compilation for the foreground-service module
- real tmux create/reuse/capture/attach/cleanup integration test

Device-dependent gates remain open until run on an API 26+ device or emulator:

- background → foreground → authenticated reconnect Maestro flow;
- alert notification content and tap-to-open Maestro flow;
- simultaneous Android/workstation input and output acceptance;
- CLI crash followed by tmux reattachment and replay;
- long-session background/network-change acceptance.
