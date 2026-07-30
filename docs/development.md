# Local development

Day-to-day validation: run the Station CLI and the Expo Android app on a device
or emulator. Requires Node ≥ 20 and pnpm.

The Station CLI targets Linux (including Ubuntu and WSL) and macOS. On a Windows
host, run these commands **inside WSL** (`wsl`, then `cd ~/code-wsl/mobily`).
Native Windows / PowerShell is not supported yet — do not use PowerShell against
`\\wsl.localhost\…` (Windows Node cannot resolve pnpm workspace symlinks there,
and `npm`/`pnpm` fail on UNC paths).

```bash
pnpm install
pnpm build
```

## Supported gate before manual testing

CI (`.github/workflows/ci.yml`) always runs `pnpm typecheck`, `pnpm lint`,
`pnpm build`, and `pnpm test` (Vitest across packages; Android `test` is unit-only).
Playwright Chromium (`pnpm --filter mobily-android run test:browser`) and the
macOS `pty-native` job run only when relevant paths change. Prefer the full local
gate when you can. For a faster preflight before manual device testing:

```bash
pnpm typecheck
pnpm --filter mobily-android lint
pnpm build
pnpm --filter @mobily/shared test
pnpm --filter mobily test
pnpm --filter mobily-android test
```

When Android browser coverage matters locally:

```bash
pnpm --filter mobily-android exec playwright install --with-deps chromium
pnpm --filter mobily-android run test:browser
```

For the production WebView harness, OpenCode-style mouse/scroll fixtures,
synthetic Android touch events, ownership resize setup, and focused debugging
commands, see
[`android/tests/browser/README.md`](../android/tests/browser/README.md).

## Terminal A — Station

```bash
pnpm build && pnpm --filter mobily exec node dist/index.js
```

Requires Microsoft’s `devtunnel` helper (install/sign-in on first run). Optional
flags: `--devtunnels-provider github|microsoft`, `--verbose`, `--session <name>`.

## Terminal B — Android app

```bash
pnpm --filter mobily-android android
```

Scan the CLI QR from the app pair screen.

## Publishing the CLI

Tagged releases (`v*`) run [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which builds the CLI, publishes `mobily` to npm, and creates a notes-only GitHub
Release (no Android APK upload). Requires the `NPM_TOKEN` repository secret.

Local dry-run (or `scripts/verify-cli-publish.sh`):

```bash
pnpm --filter @mobily/shared build
pnpm --filter mobily build
cd cli && npm pack --dry-run
```

`@mobily/shared` is bundled into the CLI via tsup (`noExternal`) and must not
appear in published runtime `dependencies`.

## Publishing the Android APK

The Android app ships as a pre-release APK attached to a GitHub Release (for
example tag `0.0.1`). There is no Play Store listing, and the release workflow
does not build the APK — attach it manually:

1. Confirm `android/app.json`: `version` and `android.package` define the APK
   identity (`io.github.kirank55.mobily`).
2. Build the APK with the EAS `preview` profile (internal distribution):

   ```bash
   pnpm --filter mobily-android eas-prod
   ```

3. Download the finished artifact from the EAS build page and create a
   pre-release with it:

   ```bash
   gh release create <tag> --prerelease --title <tag> \
     --notes "Pre-release APK for testing." app.apk
   ```
