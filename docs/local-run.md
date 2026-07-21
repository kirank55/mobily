# Local run (Expo web + CLI)

Day-to-day validation on a low-RAM machine: run the Station CLI and the Expo **web** app in Chrome. Do **not** start Android Studio or an emulator for this path.

Requires Node ≥ 20 and pnpm `10.30.3`. Prefer WSL Ubuntu for all commands below. Use nvm Node if needed:

```bash
export PATH="${HOME}/.nvm/versions/node/v24.14.1/bin:${PATH}"
cd /home/kiran/code-wsl/mobily
```

---

## 1. One-time / after pull

```bash
pnpm install
pnpm build
```

---

## 2. Automated gate (always)

```bash
pnpm typecheck
pnpm --filter mobily-android lint
pnpm build
pnpm --filter @mobily/shared test
pnpm --filter mobily test
pnpm --filter mobily-android exec vitest run
```

Notes:

- Full `pnpm lint` may fail on unrelated CLI fixtures; Android lint is the gate for web work.
- Full `pnpm test` also runs Playwright under android and can hang; use `vitest run` for the android unit gate.

Stop if typecheck, android lint, build, or vitest fail.

---

## 3. Start Station (Terminal A)

```bash
pnpm build
pnpm --filter mobily exec node dist/index.js --tunnel local --allow-insecure-local
```

Expect:

- `Tunnel: ws://localhost:<port>`
- A pairing code (and QR payload)
- The CLI may hand the TTY to the shared session after setup

Keep this process running. Note the **port** and **pairing code** (or copy the printed `mobily://pair?…` QR string).

Ctrl+C shuts down the Station.

---

## 4. Start Expo web (Terminal B)

```bash
pnpm install   # once after React version alignment / pull
pnpm --filter mobily-android web
```

Metro opens the app in the browser (or print a localhost URL — open it in Chrome).

If the browser shows a blank page or a React `useEffect` null error, clear Metro cache and retry:

```bash
pnpm --filter mobily-android exec expo start --web -c
```

On the web pair screen:

1. Paste the full `mobily://pair?…` payload, **or**
2. Enter `ws://localhost:<port>` and the 8-character pairing code
3. Pair → terminal should connect

Smoke: type in the web terminal, resize the window, confirm I/O.

---

## 5. Optional fallbacks

### Browser protocol harness (no Expo UI)

```bash
pnpm --filter mobily exec node dist/index.js --tunnel local --allow-insecure-local
# Open the Smoke test URL the CLI prints (cli/dev/smoke.html?port=…&endpoint=…)
```

### Web static export check (no live pair)

```bash
cd android
pnpm generate:terminal-assets
npx expo export --platform web
```

---

## Deferred (not for this PC day-to-day)

- Android Studio / emulator
- Camera QR, biometrics, Keystore, pinned TLS, foreground alerts
- `pnpm android:prebuild` / `pnpm android:build`

When a physical phone is available later: build a dev-client APK elsewhere, run `--tunnel devtunnels` from WSL, pair on device.

---

## Quick copy-paste (two terminals)

**A — CLI**

```bash
export PATH="${HOME}/.nvm/versions/node/v24.14.1/bin:${PATH}"
cd /home/kiran/code-wsl/mobily
pnpm build && pnpm --filter mobily exec node dist/index.js --tunnel local --allow-insecure-local
```

**B — Expo web**

```bash
export PATH="${HOME}/.nvm/versions/node/v24.14.1/bin:${PATH}"
cd /home/kiran/code-wsl/mobily
pnpm --filter mobily-android web
```
