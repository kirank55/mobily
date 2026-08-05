# Changelog

All notable changes to Mobily are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.1.3] - 2026-08-05

### Added

- Gradle-based Android APK build and install scripts on the Android package (`android:build:apk` / related package.json scripts), with updated Gradle configuration and assets.
- Native soft keyboard control for the terminal WebView, plus improved IME handling in `MobilyTerminalImeModule`.
- Short biometric grace window for Device Key signing on Android.
- Cursor Cloud environment setup notes in `AGENTS.md`, Android emulator testing docs, and Playwright helpers for terminal debugging.

### Changed

- Enhanced mouse reporting and related terminal options on the CLI/session path.
- CI workflow optimizations and Android app.json / packaging alignment (app version now `0.1.3`).

### Fixed

- Flush queued mouse reports at the process boundary so they no longer leak into the shell (issue 3).
- Leave alternate screen when the Mobily prompt returns, recovering scrollback after abrupt alt-screen exit (issue 2).
- Terminal screen swipe / inner scrolling issues and terminal ownership fixes on Android.

## [0.1.2] - 2026-07-29

### Added

- Pre-release Android APK on [GitHub Releases](https://github.com/kirank55/mobily/releases) (built with EAS; attached to `v0.1.2`), with app version `0.0.1` and application ID `io.github.kirank55.mobily`.
- `mobily --version` prints the CLI version and exits.
- Station startup requirements check (supported platform, Node.js, and resolvable `devtunnel` helper) before hosting begins.
- Connected banner on the workstation terminal when a phone session is active.
- Host terminal clear when a phone attaches, so the remote session starts from a clean screen.
- Stronger Device Key / pairing flow on Android (scanner UX) and matching station identity / binding hardening on the CLI, with updated security documentation.

### Changed

- README, homepage, and release notes point Android users at the GitHub Releases APK and describe the foreground notification as it ships (connection state; Session phases are not exposed in the notification).
- Station CLI platform support is Linux (including Ubuntu and WSL) and macOS; native Windows / PowerShell is deferred. `npx mobily` on Windows prints a coming-soon message directing users to WSL. CI `pty-native` no longer runs on `windows-latest`.
- Android terminal status / UI polish for clearer connection feedback.

### Fixed

- Restored the homepage Features section (content, styles, and the `#features` nav link all existed but the section was no longer rendered) and re-ordered sections so numbering runs 01–05.
- Removed a stale `@ts-expect-error` in `website/app/layout.tsx` that broke `pnpm typecheck` and `pnpm build`.
- Removed a leftover latency `console.log` probe from the Android terminal screen.
- Aligned the Android `react` dependency (`19.2.6`) with the workspace override and lockfile.
- Fixed a timing race in the CLI pairing end-to-end test where a stale join-time resize frame could satisfy the post-release wait, letting the `stty` probe read terminal dimensions before the restore was applied.
- Widened the tmux banner-dismissal test's wait beyond the 1s default; the shell round trip that clears the banner can exceed it on a loaded machine.

## [0.1.0] - 2026-07-25

### Added

- First public CLI release (`mobily` on npm) with Device Key pairing, live terminal streaming, Microsoft Dev Tunnels, tmux-backed sessions with bare PTY fallback, Git RPC, and workstation presence.
- Android Expo client for pairing, live xterm.js terminal, Stations list, foreground session alerts, and native Git controls.
- Tagged `v*` workflow publishes the CLI to npm and creates a notes-only GitHub Release (no Android APK artifact).

[0.1.3]: https://github.com/kirank55/mobily/releases/tag/v0.1.3
[0.1.2]: https://github.com/kirank55/mobily/releases/tag/v0.1.2
[0.1.0]: https://github.com/kirank55/mobily/releases/tag/v0.1.0
