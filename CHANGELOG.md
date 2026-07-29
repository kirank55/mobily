# Changelog

All notable changes to Mobily are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pre-release Android APK published on [GitHub Releases](https://github.com/kirank55/mobily/releases) (tag `0.0.1`), built with EAS from this repository.
- `mobily --version` prints the CLI version and exits.

### Changed

- Android app version is `0.0.1` with application ID `io.github.kirank55.mobily`, replacing the Expo placeholder `com.anonymous.mobily`. Reinstall rather than upgrade over the `0.0.1` testing APK.
- README, homepage, and release notes now point Android users at the GitHub Releases APK and describe the foreground notification as it ships (connection state; Session phases are not exposed in the notification).
- Station CLI platform support is Linux (including Ubuntu and WSL) and macOS; native Windows / PowerShell is deferred. `npx mobily` on Windows prints a coming-soon message directing users to WSL. CI `pty-native` no longer runs on `windows-latest`.

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

[0.1.0]: https://github.com/kirank55/mobily/releases/tag/v0.1.0
