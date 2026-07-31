## Agent skills

### Triage labels

Triage uses the five default canonical role names. See `.agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `.agents/domain.md`.

### Local run

To run the CLI and Android app for terminal testing, see [`docs/development.md`](docs/development.md).

Local working notes may live under `.scratch/` (gitignored). See `.agents/issue-tracker.md` for conventions.

## Cursor Cloud specific instructions

pnpm workspace monorepo with four packages: `cli` (the `mobily` Station CLI), `shared` (`@mobily/shared` wire protocol), `android` (Expo Android app), and `website` (Next.js marketing site). Dependencies are installed by the startup update script (`pnpm install --frozen-lockfile`); `node-pty` compiles from source during install. The VM ships Node 22 (repo requires `>=20`; works fine).

Standard commands are already documented in [`docs/development.md`](docs/development.md). The full supported gate is `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (turbo across all packages). Run `website` with `pnpm --filter mobily-website dev` (serves at `http://localhost:3000`).

Non-obvious caveats for this environment:

- tmux: the sandbox puts a wrapper `tmux` at `/exec-daemon/tmux` earlier on `PATH` than the real `/usr/bin/tmux`. Under that wrapper, the CLI integration test `cli/tests/sessionSnapshot.integration.test.ts` case "captures the same idle full-screen fixture from a real tmux Session" fails (empty snapshot); the rest of the suite is green. To get a fully green `pnpm test`, put the real tmux first, e.g. `mkdir -p /tmp/realtmux && ln -sf /usr/bin/tmux /tmp/realtmux/tmux && PATH="/tmp/realtmux:$PATH" pnpm test`.
- Android browser tests need Chromium: `pnpm --filter mobily-android exec playwright install --with-deps chromium` (one-off; not in the update script), then `pnpm --filter mobily-android run test:browser`. Note: the case "renders a detailed OpenCode-like Session Snapshot in the production document" currently fails on `main` (a cursor style/blink assertion) — this is pre-existing and also red in CI's `android-browser` job, not an environment issue.
- CLI Station end-to-end run (`node cli/dist/index.js` / `npx mobily`) requires Microsoft's `devtunnel` helper plus an interactive Microsoft/GitHub login for reachability — not available headless. The core loop (PTY `Session` + WebSocket wire protocol) runs locally without the tunnel or Device Key auth: attach a plain `ws` client to `startServer({ session })`, receive the `session-snapshot`, and drive the PTY with `{type:'input',data}` frames (see `cli/tests/sessionSnapshot.integration.test.ts` for the pattern).
- The Android Expo app needs an Android SDK + emulator/device to run (`pnpm --filter mobily-android android`); not runnable headless. Use the Playwright browser suite as the WebView terminal feedback loop instead.
