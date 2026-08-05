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

For starting, checking, stopping, and troubleshooting the local Android
emulator, see [`android-emulator.md`](android-emulator.md).

## Release format

One product version ships the CLI (npm) and the Android APK (GitHub Releases
asset) together. Example: [v0.1.3](https://github.com/kirank55/mobily/releases/tag/v0.1.3).

### Version identity

| Field | Value |
| --- | --- |
| Semver | `X.Y.Z` (no `v` prefix in package manifests) |
| Git tag / GitHub Release | `vX.Y.Z` |
| CLI | [`cli/package.json`](../cli/package.json) `version` → published as `mobily@X.Y.Z` |
| Android | [`android/package.json`](../android/package.json) `version` **and** [`android/app.json`](../android/app.json) `expo.version` → same `X.Y.Z` |
| Application ID | `io.github.kirank55.mobily` (unchanged across releases) |
| Changelog | [`CHANGELOG.md`](../CHANGELOG.md) — [Keep a Changelog](https://keepachangelog.com/); move `[Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD` and add the compare footer link |

`@mobily/shared` stays private/`0.0.0`; it is bundled into the CLI via tsup
(`noExternal`) and must not appear in published CLI runtime `dependencies`.

### Cut checklist

1. Branch from clean `main`: `release/X.Y.Z`.
2. Bump the three version fields above and write the CHANGELOG section.
3. Open a PR, merge to `main`.
4. On `main`, tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

5. Tag push runs [`.github/workflows/release.yml`](../.github/workflows/release.yml)
   (needs `NPM_TOKEN`): build CLI → `npm publish` → create the GitHub Release
   `vX.Y.Z` with install notes. The workflow does **not** build or upload an APK.
6. Build and attach the Gradle debug APK to that same release (see below).
7. Smoke: `npm view mobily version` / `npx mobily@X.Y.Z --version`, and install
   the APK from the release page.

CLI pack dry-run before tagging (`scripts/verify-cli-publish.sh` or):

```bash
pnpm --filter @mobily/shared build
pnpm --filter mobily build
cd cli && npm pack --dry-run
```

### Android APK asset

No Play Store listing. Attach one APK to the **`vX.Y.Z`** release (not a separate
tag). Preferred build is local Gradle debug via the Android package scripts
(requires a generated native tree under `android/android/` — run
`pnpm --filter mobily-android prebuild` if missing):

```bash
pnpm --filter mobily-android apk:build
# output: android/android/app/build/outputs/apk/debug/app-debug.apk
cp android/android/app/build/outputs/apk/debug/app-debug.apk mobily-X.Y.Z.apk
gh release upload vX.Y.Z mobily-X.Y.Z.apk --clobber
rm mobily-X.Y.Z.apk   # do not commit the APK
```

Asset naming convention: `mobily-X.Y.Z.apk`. Local install without uploading:
`pnpm --filter mobily-android apk:install`.

Optional alternative: EAS preview (`pnpm --filter mobily-android eas-prod`), then
upload that artifact to the same `vX.Y.Z` release with the same filename.
