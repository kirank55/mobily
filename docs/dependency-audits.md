# Dependency audit dispositions

Notes for maintainers when `pnpm audit` reports issues that are accepted temporarily.

## `uuid` / Expo xcode tooling — upstream exception

Checked 2026-07-14. `pnpm audit` reports CVE-2026-41907 for `uuid@7.0.3` on this
development-only path:

`expo@57.0.4 → @expo/config-plugins@57.0.3 → xcode@3.0.1 → uuid@7.0.3`

These are the latest compatible Expo, config-plugin, and xcode releases in the
npm registry on the check date. `xcode@3.0.1` declares `uuid ^7.0.3`; there is
no compatible upstream upgrade to `uuid >=11.1.1`. Mobily does not call the
affected UUID v3/v5/v6 external-buffer APIs, and this dependency is used by
Expo's Apple project-generation tooling rather than the CLI or Android runtime.

Do not add a package-manager override across the unsupported UUID major. Recheck
this exception whenever Expo or `xcode` changes, and remove it as soon as an
upstream compatible release becomes available.
