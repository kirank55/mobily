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

CI (`.github/workflows/ci.yml`) runs `pnpm typecheck`, `pnpm lint`, `pnpm build`,
and `pnpm test` (after Playwright Chromium install for Android). Prefer that full
gate when you can. For a faster local preflight before manual device testing:

```bash
pnpm typecheck
pnpm --filter mobily-android lint
pnpm build
pnpm --filter @mobily/shared test
pnpm --filter mobily test
pnpm --filter mobily-android exec vitest run
```

Use `vitest run` for the Android unit gate when you want to skip Playwright.

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
