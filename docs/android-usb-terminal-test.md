# Android on-device terminal testing (Dev Tunnels)

Working note for end-to-end terminal testing on a physical Android phone using **Microsoft Dev Tunnels** for the Station. USB debugging is optional (handy for logs/screenshots and as a Metro fallback).

For browser-only day-to-day checks (no phone), see README → **Local development**. For latency targets after you are connected, see `.scratch/latency-baseline.md`.

## Why tunnels

| Path | Station reachability | When to use |
| ---- | -------------------- | ----------- |
| `--tunnel devtunnels` | Public `wss://…` via Microsoft Dev Tunnels | **Default for phone testing** — works across Wi-Fi client isolation, WSL NAT, and cellular |
| `--tunnel local` | LAN or USB-reverse `wss://…` with cert pin | Same Wi-Fi without isolation, or USB-only setups (see Appendix) |

Dev Tunnels avoid advertising WSL `172.x` addresses and skip `adb reverse` for the Station port.

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

### 2. Start Station with Dev Tunnels (Terminal A)

```bash
# WSL, repo root
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
pnpm --filter mobily exec node dist/index.js --tunnel devtunnels --session mobily-phone-test
```

Useful flags:

```bash
# Force login provider / diagnostics
pnpm --filter mobily exec node dist/index.js --tunnel devtunnels --devtunnels-provider github --verbose
pnpm --filter mobily exec node dist/index.js --tunnel devtunnels --devtunnels-provider microsoft --verbose
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
- [ ] Soft keyboard open/close does not permanently break the view (note any Fit/zoom resets — known issues in `.scratch/known-bugs.md`).
- [ ] Optional: Home → reopen Mobily — session reconnects without “Connection lost” (see `android/e2e/background-reconnect.yml`).
- [ ] Latency: ≥20 keystrokes with visible output; read **P50 / P95** from the terminal status bar or `[mobily latency]` Metro logs. Compare to Dev Tunnels targets in `.scratch/latency-baseline.md` (P50 ≤ 80 ms, P95 ≤ 200 ms).

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
| Slow or high P95 | Dev Tunnel RTT | Expected vs local; compare `.scratch/latency-baseline.md` |
| `Unmatched Route` for `mobily://pair` | Deep link not routed on native | Use in-app **ADD** + camera QR |
| `adb shell input tap` → `INJECT_EVENTS` | MIUI blocks injection | Tap manually, or enable **USB debugging (Security settings)** |
| Pairing works then terminal fails | Stale Metro / wrong JS host | Reload from Expo tunnel URL or re-reverse `:8081` |

## Quick command cheat sheet

```bash
# WSL — Station (Dev Tunnels)
pnpm --filter mobily exec node dist/index.js --tunnel devtunnels --session mobily-phone-test

# WSL — Metro (Expo tunnel)
cd android && pnpm exec expo start --port 8081 --tunnel
```

```powershell
# Optional USB — Metro only + launch
& $adb reverse tcp:8081 tcp:8081
& $adb shell am start -a android.intent.action.VIEW -d "exp+mobily://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
```

## Appendix: local tunnel (no Dev Tunnels)

Account-free LAN path. Android requires pinned TLS (no `--allow-insecure-local`).

```bash
pnpm --filter mobily exec node dist/index.js --tunnel local --session mobily-local-test
```

On WSL + isolated Wi-Fi, advertise localhost and reverse the Station port:

```bash
export MOBILY_LOCAL_ADVERTISE_HOST=127.0.0.1
pnpm --filter mobily exec node dist/index.js --tunnel local --session mobily-usb-test
```

```powershell
& $adb reverse tcp:<PORT> tcp:<PORT>   # Station port from CLI log
& $adb reverse tcp:8081 tcp:8081       # Metro if not using Expo tunnel
```

## Related

- README — Quick Start / Dev Tunnels helper / Local development
- `.scratch/latency-baseline.md` — RTT targets (local vs Dev Tunnels)
- `.scratch/known-bugs.md` — Fit / snapshot / reconnect defects
- `android/e2e/*.yml` — Maestro flows (scan-connect, background-reconnect)
