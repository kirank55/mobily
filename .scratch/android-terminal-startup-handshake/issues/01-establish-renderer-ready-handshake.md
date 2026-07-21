# Establish a reliable renderer-ready handshake

Status: ready-for-agent

## Parent

[Reliable Android Terminal Startup Handshake](../spec.md)

## What to build

Make Android terminal renderer startup explicit and recoverable. The terminal WebView must retain one stable document instance across ordinary React renders, use the supported native message bridge, and distinguish page-load completion from xterm readiness.

React Native must retry readiness negotiation until the initialized renderer responds, stop and clean up retries after success or teardown, and replace indefinite loading with a renderer-specific failure and Retry action when readiness does not complete within a bounded interval.

This slice must include a deterministic startup harness that can delay renderer initialization and discard the first readiness message while observing the user-visible loading, ready, and failure outcomes.

## Acceptance criteria

- [ ] Ordinary connection, resize, ownership, and loading-state rerenders do not recreate or reload the terminal WebView document.
- [ ] Native-to-WebView terminal messages use react-native-webview’s supported message API rather than hand-built JavaScript event injection.
- [ ] WebView page-load completion does not by itself transition the renderer to ready.
- [ ] The initialized terminal document answers readiness probes after its terminal message listener is installed.
- [ ] A missed initial readiness message is recovered by bounded, idempotent retries.
- [ ] Readiness timers stop after success and are cancelled on WebView reload, unmount, and terminal teardown.
- [ ] Readiness timeout produces a renderer-specific error and Retry action rather than an indefinite “Loading Session…” state.
- [ ] Renderer Retry restarts renderer startup without clearing a valid Device Key pairing.
- [ ] A deterministic automated test discards the initial readiness message, delays renderer initialization, and verifies eventual readiness.
- [ ] A deterministic timeout test verifies the user-visible renderer failure and Retry behavior.
- [ ] Existing terminal rendering, connection overlay, input, resize, and Terminal Size Ownership behavior remains green.

## Blocked by

None - can start immediately
