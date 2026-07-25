# Local development

Day-to-day validation: run the Station CLI and the Expo Android app on a device
or emulator. Requires Node ≥ 20 and pnpm.

On Windows, run these commands **inside WSL** (`wsl`, then `cd ~/code-wsl/mobily`).
Do not use PowerShell against `\\wsl.localhost\…` — Windows Node cannot resolve
pnpm workspace symlinks there, and `npm`/`pnpm` fail on UNC paths.

```bash
pnpm install
pnpm build
```

## Supported gate before manual testing

```bash
pnpm typecheck
pnpm --filter mobily-android lint
pnpm build
pnpm --filter @mobily/shared test
pnpm --filter mobily test
pnpm --filter mobily-android exec vitest run
```

Full `pnpm lint` may fail on unrelated CLI fixtures; full `pnpm test` also runs
Playwright under android and can hang — use `vitest run` for the android unit
gate.

## Terminal A — Station

```bash
pnpm build && pnpm --filter mobily exec node dist/index.js --tunnel local
```

## Terminal B — Android app

```bash
pnpm --filter mobily-android android
```

Scan the CLI QR from the app pair screen. For protocol-only browser smoke (no
Android UI), run the Station with `--allow-insecure-local` and open the Smoke
test URL the CLI prints (`cli/dev/smoke.html?…`).

## Publishing the CLI

Tagged releases (`v*`) run [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which builds the CLI, publishes `mobily` to npm, and creates a GitHub Release.
Requires the `NPM_TOKEN` repository secret.

Local dry-run (or `scripts/verify-cli-publish.sh`):

```bash
pnpm --filter @mobily/shared build
pnpm --filter mobily build
cd cli && npm pack --dry-run
```

`@mobily/shared` is bundled into the CLI via tsup (`noExternal`) and must not
appear in published runtime `dependencies`.
