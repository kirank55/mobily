# Phase 4 — Structured Git Features: Implementation Contract

> Direct-to-`main` implementation of Phase 4 from `docs/plan.md` and
> `docs/tasks.md`. Every checkpoint must leave the monorepo green.

## Scope

Phase 4 adds two user-facing capabilities:

1. An authenticated, structured Git interface for status, history, branches,
   staging, commits, and paged diffs.
2. A host list that retains multiple paired Stations and switches between them
   without scanning another QR code.

The existing terminal remains available and shares one authenticated connection
with the Git interface for the selected Station.

## Protocol contract

Phase 4 uses protocol version `2`. Terminal and authentication frames retain
their existing shapes. Version 2 adds the following post-authentication frames:

```ts
type RpcRequestFrame = {
  type: 'rpc';
  id: string;
  method: string;
  params: JsonObject;
};

type RpcResponseFrame =
  | { type: 'rpc'; id: string; result: JsonValue }
  | { type: 'rpc'; id: string; error: { code: string; message: string } };

type RpcStreamFrame = {
  type: 'rpc-stream';
  id: string;
  chunk: string;
  done: boolean;
  truncated?: boolean;
  nextCursor?: string;
  error?: { code: string; message: string };
};
```

Identifiers and method names are bounded safe strings. Individual stream chunks
are capped at 16 KiB. Request parameters are validated again by the registered
method handler; callers can never supply executable names or raw argument lists.

## Git RPC methods

| Method | Kind | Parameters | Result |
| --- | --- | --- | --- |
| `git.status` | read | `{}` | normalized repository/branch/file status |
| `git.log` | read | `{ skip?, limit? }` | paged commit summaries |
| `git.branches` | read | `{}` | current and local branches |
| `git.checkout` | mutation | `{ branch }` | updated branch summary |
| `git.stage` | mutation | `{ paths }` | updated status |
| `git.unstage` | mutation | `{ paths }` | updated status |
| `git.commit` | mutation | `{ message }` | commit hash and summary |
| `git.diff` | stream | `{ path?, staged?, cursor?, maxLines? }` | raw unified diff chunks |

All Git operations use the CLI startup directory, which is also the terminal
session's initial working directory. Mutations are serialized. Paths must be
repository-relative, must not escape the working tree, and are passed after
`--`. Branch checkout never forces or discards local changes.

`git.diff` directly spawns Git without a shell using fixed arguments including
`--no-ext-diff`, `--no-color`, and `--unified=3`. Output is decoded
incrementally, paged by line count, and terminated when the page limit, request
timeout, or WebSocket disconnect is reached.

## Android connection ownership

A root Station connection provider owns the selected pairing and its `WsClient`.
Terminal, Git, and host routes consume that provider, so navigating away from
the terminal does not destroy the Station connection. Outstanding RPC work is
rejected on disconnect and may be retried explicitly after reconnect.

## Multi-Station persistence

Pairings are stored as a versioned encrypted list keyed by Device Binding ID.
Each record contains its Station endpoint, optional certificate pin, Keystore
alias, paired time, and optional last-connected time. Selection is persisted
separately.

The Phase 3 singleton record at `mobily.pairing` is migrated atomically. It is
deleted only after the new list has been written. Its existing
`biometric_key` Keystore alias remains supported.

New pairings receive one Android Keystore alias per Device Binding ID. Pairing a
second Station must not replace or invalidate the first Station's private key.
Failed pairing attempts delete the newly created key.

Host status means endpoint reachability, not successful Device Key
authentication. Reachability probes run only while the host list is visible,
are time-bounded, and do not prompt for biometrics.

## Diff presentation

Android parses the streamed unified diff into file headers, hunks, and typed
lines. Both unified and side-by-side modes use virtualized lists. Side-by-side
rows align contiguous removal/addition blocks and insert empty cells where the
block lengths differ. Additional pages append through an opaque continuation
cursor.

## Verification gates

Each checkpoint runs its focused tests plus typechecking. Before Phase 4 is
marked complete, all of the following must pass:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `pnpm android:prebuild`
- Android native build after the Device Key module is introduced
- Maestro host-list navigation flow

Manual acceptance covers browsing/staging/committing without the terminal,
smooth rendering of a 1,000+ line diff in both modes, cancellation of an active
diff on disconnect, and reconnecting to either of two paired Stations after an
app restart.
