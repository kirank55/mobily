# Latency Baseline — Phase 3

Keystroke-to-output round-trip time for the Mobily Android app. Each input
frame carries a client-generated correlation tag; the CLI returns pending tags
with the first following PTY output frame.

## Methodology

1. The user presses a key in the terminal WebView.
2. The WebView records the start time and sends
   `{ type: "input", data: "...", latencyTag: "<id>" }` through the React Native bridge.
3. The WebSocket client forwards the tagged input frame to the CLI.
4. The CLI writes the data to the PTY.
5. The CLI attaches pending correlation tags to the first following
   `{ type: "output", data: "...", latencyTags: [...] }` frame for that client.
6. The WebSocket client calls `TerminalView.write(data, latencyTags)`.
7. The WebView computes RTT for every returned tag, then renders the output on
   the next `requestAnimationFrame`.
8. Every 20 samples, the app logs and displays rolling P50/P95 values in the
   terminal status bar.

The animation-frame batching adds a display-rate-adaptive delay: at most about
16 ms at 60 Hz, 11 ms at 90 Hz, or 8 ms at 120 Hz.

## Measurement Status

> [!IMPORTANT]
> A real on-device baseline has not been recorded yet. The values below are
> acceptance targets, not measurements. Phase 3 is not complete until measured
> Dev Tunnels P50/P95 values are recorded from a physical Android device.

### Local transport reference

| Metric |  Target | Measured | Notes                             |
| ------ | ------: | -------: | --------------------------------- |
| P50    | ≤ 30 ms |  Pending | Pinned-TLS `--tunnel local`       |
| P95    | ≤ 60 ms |  Pending | Measure on the same Wi-Fi network |

### Dev Tunnels (`--tunnel devtunnels`, internet relay)

| Metric |   Target | Measured | Notes                         |
| ------ | -------: | -------: | ----------------------------- |
| P50    |  ≤ 80 ms |  Pending | Typical cloud relay latency   |
| P95    | ≤ 200 ms |  Pending | Relay-routing spikes expected |

## Throughput Harness

- Test workload: 10,000 lines × 80 bytes, approximately 800 KB of terminal output.
- Harness: `android/dev/term.html`, generated from the production terminal document.
- Expected result: no dropped output while the WebView flushes all queued chunks
  once per animation frame.
- This harness verifies rendering and batching in isolation; it does not replace
  the on-device end-to-end measurement.

## Recording the On-Device Baseline

1. Build and launch the development client on an Android device.
2. Pair with a running CLI.
3. Connect with `--tunnel devtunnels`.
4. Enter at least 20 keystrokes that produce terminal output; 100 or more
   samples are preferred.
5. Read P50/P95 from the terminal status bar or the `[mobily latency]` Metro log.
6. Replace `Pending` in the relevant table and record the device model, network
   type, date, and sample count below it.

## Browser-Only Batching Check

Open `android/dev/latency.html` and start the measurement. This measures only
animation-frame scheduling overhead and cannot supply the end-to-end baseline.
