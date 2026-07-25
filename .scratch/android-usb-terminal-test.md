# Android on-device terminal testing (Dev Tunnels)

Working note for end-to-end terminal testing on a physical Android phone using **Microsoft Dev Tunnels** for the Station. USB debugging is optional (handy for logs/screenshots and as a Metro fallback).

For browser-only day-to-day checks (no phone), see [docs/development.md](../docs/development.md). For latency targets after you are connected, see [latency-baseline.md](latency-baseline.md).

## Why Dev Tunnels

`npx mobily` always uses Microsoft Dev Tunnels (public `wss://…`). That works across Wi-Fi client isolation, WSL NAT, and cellular, and avoids advertising WSL `172.x` addresses or `adb reverse` for the Station port. There is no `--tunnel` flag and no local LAN backend.

## Prerequisites

- Node ≥ 20 and pnpm in WSL (`nvm` login shell is fine).
- Mobily **development client** installed (`com.anonymous.mobily`), e.g. via `pnpm --filter mobily-android android`.
- Microsoft **`devtunnel`** helper installed and logged in (Mobily prints the install command if missing):

```bash
# Linux / WSL
curl -sL https://aka.ms/DevTunnelCliInstall | bash

# Then once (GitHub or Microsoft account)
devtunnel user login -g   # or: devtunnel user login
```

- Phone on any network with internet (Wi-Fi or cellular).
- Optional: USB debugging + Windows `adb` for Metro reverse, logcat, screenshots (`winget install Google.PlatformTools`).

## Architecture

```
Phone ──wss──► Microsoft Dev Tunnel ──► WSL Station (CLI)
Phone ──https/ws──► Expo tunnel (or adb reverse :8081) ──► WSL Metro
```

Pairing QR embeds the Dev Tunnel WebSocket URL (no local TLS pin). Android connects over the public tunnel after Device Key auth.

## Procedure

### 1. Build (once / after CLI changes)

```bash
# WSL, repo root
pnpm install
pnpm build
```

### 2. Start Station (Terminal A)

```bash
# WSL, repo root
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
pnpm --filter mobily exec node dist/index.js --session mobily-phone-test
```

Useful flags:

```bash
# Force login provider / diagnostics
pnpm --filter mobily exec node dist/index.js --devtunnels-provider github --verbose
pnpm --filter mobily exec node dist/index.js --devtunnels-provider microsoft --verbose
```

Note from the log:

- `Tunnel: wss://…` (Dev Tunnel hostname — phone-reachable)
- `Pairing code: ........`
- ASCII QR in the terminal (scan with the app)

If an interrupted run left the account quota full:

```bash
devtunnel delete-all
```

### 3. Start Metro (Terminal B)

Prefer Expo’s tunnel so the phone does not need USB reverse for JS:

```bash
# WSL
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd android
EXPO_NO_TELEMETRY=1 pnpm exec expo start --port 8081 --tunnel
```

Metro prints an `exp://…` / `https://….exp.direct` URL. Open that from the Expo development client (Recent, Scan QR, or paste).

**Fallback (USB):** if Expo tunnel is flaky, use localhost Metro + reverse:

```bash
# WSL — Metro
cd android && EXPO_NO_TELEMETRY=1 pnpm exec expo start --port 8081 --host localhost
```

```powershell
# Windows
$adb = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe"
& $adb reverse tcp:8081 tcp:8081
& $adb shell am start -a android.intent.action.VIEW -d "exp+mobily://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
```

### 4. Open the development client

1. Launch **mobily** (Development Build) on the phone.
2. Connect to the Metro URL from step 3 (Expo tunnel URL, or USB `127.0.0.1:8081`).
3. Wait for bundling → **Choose your Station**.
4. Dismiss the Expo developer menu if it appears (Continue / Close).

### 5. Pair (manual — required)

Native pairing is **QR via camera**, not `mobily://pair` deep link.

1. Tap **ADD** on the hosts screen.
2. Grant camera permission if prompted.
3. Scan the Station QR from Terminal A (Dev Tunnels endpoint).
4. Confirm the biometric prompt (Device Key).

On success the app navigates to the terminal after snapshot apply.

**Do not** open `mobily://pair?...` with `am start` on the native app: Expo Router currently shows **Unmatched Route** for that URL.

### 6. Exercise the terminal

Checklist:

- [ ] Status shows connected (not “Connecting…” / “Station unreachable”).
- [ ] Snapshot paints a shell prompt (tmux session or bare PTY).
- [ ] Type `echo hello` — output appears.
- [ ] Special keys: arrows, Tab, Ctrl+C interrupt.
- [ ] Soft keyboard open/close does not permanently break the view (note any Fit/zoom resets — known issues in [known-bugs.md](known-bugs.md)).
- [ ] Optional: Home → reopen Mobily — session reconnects without “Connection lost” (see `android/e2e/background-reconnect.yml`).
- [ ] Latency: ≥20 keystrokes with visible output; read **P50 / P95** from the terminal status bar or `[mobily latency]` Metro logs. Compare to Dev Tunnels targets in [latency-baseline.md](latency-baseline.md) (P50 ≤ 80 ms, P95 ≤ 200 ms).

### 7. Capture evidence (optional)

With USB debugging:

```powershell
& $adb shell screencap -p /sdcard/mobily-terminal.png
& $adb pull /sdcard/mobily-terminal.png .
& $adb logcat -d | Select-String -Pattern "Mobily|mobily latency"
```

## Known pitfalls

| Symptom | Likely cause | Fix |
| -------- | ------------ | --- |
| CLI asks to install / login `devtunnel` | Helper missing or logged out | Install per README; `devtunnel user login` |
| Tunnel create fails / quota | Leftover tunnels | `devtunnel delete-all`, retry |
| Dev client stuck on “Start a local development server” | Metro not reachable | Use `expo start --tunnel`, or USB reverse to `:8081` |
| Slow or high P95 | Dev Tunnel RTT | Compare [latency-baseline.md](latency-baseline.md) |
| `Unmatched Route` for `mobily://pair` | Deep link not routed on native | Use in-app **ADD** + camera QR |
| `adb shell input tap` → `INJECT_EVENTS` | MIUI blocks injection | Tap manually, or enable **USB debugging (Security settings)** |
| Pairing works then terminal fails | Stale Metro / wrong JS host | Reload from Expo tunnel URL or re-reverse `:8081` |

## Quick command cheat sheet

```bash
# WSL — Station (Dev Tunnels)
pnpm --filter mobily exec node dist/index.js --session mobily-phone-test

# WSL — Metro (Expo tunnel)
cd android && pnpm exec expo start --port 8081 --tunnel
```

```powershell
# Optional USB — Metro only + launch
& $adb reverse tcp:8081 tcp:8081
& $adb shell am start -a android.intent.action.VIEW -d "exp+mobily://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
```

## Related

- [README.md](../README.md) — Getting started / Dev Tunnels helper
- [docs/development.md](../docs/development.md) — monorepo Station + Android run
- [latency-baseline.md](latency-baseline.md) — RTT targets (Dev Tunnels)
- [known-bugs.md](known-bugs.md) — Fit / snapshot / reconnect defects
- `android/e2e/*.yml` — Maestro flows (scan-connect, background-reconnect)
