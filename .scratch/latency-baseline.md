# Latency baseline (working note)

Keystroke-to-output RTT targets and measurement notes. Moved out of `docs/`.
On-device Dev Tunnels P50/P95 have not been recorded yet.

## Targets

| Transport | P50 target | P95 target |
| --------- | ---------: | ---------: |
| `--tunnel local` (same Wi-Fi) | ≤ 30 ms | ≤ 60 ms |
| `--tunnel devtunnels` | ≤ 80 ms | ≤ 200 ms |

## How to measure

1. Build and launch the development client on an Android device.
2. Pair with a running CLI (`--tunnel local` or `--tunnel devtunnels`).
3. Enter at least 20 keystrokes that produce terminal output (100+ preferred).
4. Read P50/P95 from the terminal status bar or `[mobily latency]` Metro log.

Browser-only batching check: `android/dev/latency.html` (not an end-to-end baseline).
Throughput harness: `android/dev/term.html` (~800 KB queued output; no dropped frames expected).
