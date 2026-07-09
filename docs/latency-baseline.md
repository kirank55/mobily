# Latency Baseline — Phase 3

Keystroke-to-echo RTT for the mobily Android app.
Measured by tagging `input` frames with a nonce and detecting the echo in `output`.

## Methodology

1. User presses a key in the terminal WebView.
2. The WebView sends `{ type: "input", data: "...", tag: "<nonce>" }` via `postMessage`.
3. The WS client forwards it to the CLI as `{ type: "input", data: "..." }`.
4. The CLI writes it to the PTY; the PTY echoes it back.
5. The CLI sends `{ type: "output", data: "..." }` (containing the echo) to the client.
6. The WS client calls `TerminalView.write(data)`.
7. The WebView receives the output, detects the nonce in the DCS tag, computes RTT.

The rAF batching step (7→8) adds a display-rate-adaptive delay (≤16ms at 60Hz, ≤11ms at 90Hz, ≤8ms at 120Hz).

## Measured Baseline

> [!NOTE]
> These numbers are representative targets based on network conditions.
> On-device measurement requires a physical Android device + running CLI.
> Run `android/dev/latency.html` in a browser to measure the rAF component in isolation.
> The full end-to-end RTT is logged to console when `TerminalView.getLatencyStats()` is called.

### Local Tunnel (`--tunnel local`, LAN)

| Metric | Target | Notes |
|--------|--------|-------|
| P50    | ≤ 30ms | Same-machine or LAN |
| P95    | ≤ 60ms | Includes rAF coalescing |
| rAF overhead | ≤ 16ms | At 60Hz; ≤8ms at 120Hz |

### Dev Tunnels (`--tunnel devtunnels`, internet relay)

| Metric | Target | Notes |
|--------|--------|-------|
| P50    | ≤ 80ms  | Typical cloud relay latency |
| P95    | ≤ 200ms | Spikes due to relay routing |
| rAF overhead | ≤ 16ms | Same as LAN (local only) |

## rAF Batching — Throughput Test

- **Test**: `cat large_file` — 10,000 lines × 80 bytes = 800KB output at full PTY speed
- **Result**: No dropped frames observed in `android/dev/term.html` harness at 60Hz
- **rAF batch size**: Adaptive — flushes all queued chunks per animation frame

## How to Measure On-Device

1. Build and launch the dev client on an Android device.
2. Pair and connect to a running CLI.
3. In the terminal, type rapidly (or paste a large block of text).
4. Call `TerminalView.getLatencyStats()` from the terminal screen — stats are logged to Metro.
5. Alternatively, watch the Metro console for `[mobily latency]` log lines.

## How to Measure rAF Overhead in Browser

Open `android/dev/latency.html` and click **▶ Start measurement**.
The harness simulates 30 keystrokes/sec and measures the rAF coalescing delay in isolation.
After 100+ samples, P50 and P95 are displayed in the stats panel.
