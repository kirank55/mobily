# Reliable Android Terminal Startup Handshake

Status: ready-for-agent

## Problem Statement

An Android user can successfully scan the CLI pairing QR, confirm both biometric prompts, authenticate to the Station, and reach a green connected state while the terminal remains permanently stuck at “Loading Session…”.

The failure is not explained by the Tunnel, pairing, Device Key authentication, or Session Snapshot generation. Live investigation confirmed that the Dev Tunnel and pairing endpoint were reachable, the Station stored the new Device Key binding, the WebSocket authenticated, and React Native received a Session Snapshot. Visible tracing on a physical Android device also confirmed that native-to-WebView messages—including connection state, resize, size ownership, and Session Snapshot messages—crossed the bridge.

The terminal still did not paint because startup currently relies on several independently timed one-shot events:

- the Station may publish the initial Session Snapshot before the terminal route subscribes;
- React Native may treat WebView page load as terminal readiness before xterm has installed its message listener;
- the WebView may emit its initial ready notification before the native bridge is ready;
- a React rerender may replace an unstable WebView source object and restart document loading;
- a missed ready or snapshot event has no replay contract, bounded recovery path, or actionable error state.

These races leave the connection marked connected while the renderer has no usable first frame. The existing headless-browser terminal tests do not reproduce all native WebView lifecycle and bridge ordering behavior, so they can pass while the physical Android app remains stuck.

## Solution

Android terminal startup will use one explicit, replayable handshake from authenticated Session to painted terminal:

1. The Station connection retains the latest authenticated Session Snapshot.
2. The terminal WebView loads from a stable source that is not recreated during ordinary React renders.
3. WebView page load and xterm renderer readiness remain distinct states.
4. React Native and the terminal document perform a retryable readiness exchange using the supported WebView message bridge.
5. Once xterm is ready, React Native delivers or replays the latest Session Snapshot.
6. The WebView applies the snapshot and acknowledges first paint.
7. Only that acknowledgement transitions the terminal from loading to live and permits post-paint history transfer.

If any stage does not complete within a bounded interval, Android will replace the indefinite loading state with a stage-specific, user-facing failure and retry action. Development tracing used during diagnosis will be removed from the production interface.

## User Stories

1. As an Android user, I want the terminal to load after successful pairing, so that a healthy Session is usable immediately.
2. As an Android user, I want the terminal to load after selecting an already paired Station, so that route timing does not affect reliability.
3. As an Android user, I want a Session Snapshot received before the terminal route mounts to be retained, so that the first frame is not lost.
4. As an Android user, I want a Session Snapshot received before xterm is ready to be delivered later, so that renderer initialization timing does not strand the terminal.
5. As an Android user, I want WebView page completion and xterm readiness treated separately, so that Android does not send terminal state to an uninitialized listener.
6. As an Android user, I want readiness negotiation retried when an initial bridge message is missed, so that one lost startup event cannot block the Session.
7. As an Android user, I want the latest Session Snapshot replayed when readiness is re-announced, so that startup recovery is level-triggered rather than one-shot.
8. As an Android user, I want duplicate readiness messages handled safely, so that retries do not duplicate or corrupt the terminal frame.
9. As an Android user, I want duplicate snapshot delivery handled safely before first paint, so that recovery does not produce mixed terminal state.
10. As an Android user, I want the terminal to become live only after xterm acknowledges snapshot application, so that a green connection does not falsely imply a rendered Session.
11. As an Android user, I want scrollback requested only after the first frame is painted, so that history cannot overtake startup state.
12. As an Android user, I want connection, resize, size-ownership, snapshot, and live-output messages processed in a defined order, so that startup is deterministic.
13. As an Android user, I want switching Stations to clear a previous Station’s retained snapshot, so that terminal state never leaks across Station bindings.
14. As an Android user, I want disconnecting explicitly to clear startup state, so that a future connection cannot reuse stale readiness or snapshot data.
15. As an Android user, I want reconnecting to retain the visible frame while waiting for a replacement snapshot, so that the startup fix does not regress reconnect behavior.
16. As an Android user, I want ordinary React state updates not to reload the WebView, so that connection and ownership updates cannot restart terminal initialization.
17. As an Android user, I want the app to use react-native-webview’s supported messaging API, so that bridge behavior is consistent across Android WebView versions.
18. As an Android user, I want readiness probes bounded and cleaned up after success or unmount, so that startup recovery does not leak timers or consume resources indefinitely.
19. As an Android user, I want a clear error if xterm never initializes, so that I am not left staring at an endless loading screen.
20. As an Android user, I want a clear error if the native-to-WebView bridge cannot deliver messages, so that I can distinguish renderer failure from Station failure.
21. As an Android user, I want a Retry action to restart only the failed startup handshake when the authenticated Station remains healthy, so that I do not have to re-pair unnecessarily.
22. As an Android user, I want re-pairing suggested only for Device Key or authentication failures, so that rendering failures do not destroy a valid pairing.
23. As an Android user, I want the same startup behavior after app reload, background restoration, and navigation from the Stations screen, so that lifecycle entry path does not matter.
24. As an Android user, I want the same startup behavior for idle shells and full-screen terminal applications, so that content complexity does not alter readiness.
25. As an Android user, I want terminal controls to become active only when the renderer can consume their messages, so that early input is not silently discarded.
26. As an Android user, I want the strict offline terminal-document security boundary preserved, so that startup reliability does not require enabling external network access.
27. As a developer, I want native WebView lifecycle ordering represented in automated tests, so that browser-only success cannot mask Android startup regressions.
28. As a developer, I want the exact early-snapshot/late-renderer race reproduced deterministically, so that the reported physical-device failure has a red-capable regression test.
29. As a developer, I want tests to assert visible startup outcomes rather than private callback counts, so that implementation can evolve without weakening the contract.
30. As a developer, I want temporary native and WebView trace overlays removed after the failure is locked down, so that diagnostic UI does not ship.
31. As a developer, I want startup failures to report their current stage in development logs, so that future bridge regressions can be diagnosed without invasive temporary edits.
32. As a maintainer, I want a physical-device acceptance check after the automated gate, so that Android WebView behavior is verified on the platform where the regression occurred.

## Implementation Decisions

- Terminal startup is modeled as an ordered handshake with distinct document-loading, renderer-ready, snapshot-available, snapshot-applied, and live states.
- WebView page-load completion is not sufficient evidence that xterm is ready. Snapshot delivery is released only by renderer readiness or a bounded native fallback that cannot mark the terminal live without a snapshot-applied acknowledgement.
- React Native sends terminal messages through react-native-webview’s supported `postMessage` interface. Hand-built JavaScript event injection is not the primary transport.
- The terminal document responds to readiness probes after its terminal listener is installed. Readiness negotiation is retryable and idempotent.
- Readiness probes are bounded, stop after successful readiness, and are cancelled on WebView reload, component unmount, and connection teardown.
- The WebView source has stable identity for the lifetime of a mounted terminal view. Connection-state rerenders, ownership changes, and diagnostic state updates must not recreate or reload the document.
- The Station connection retains the latest authenticated Session Snapshot and replays it to a late terminal subscriber. This latest-value behavior is part of the subscription contract rather than an incidental component-local cache.
- Retained Session Snapshot state is reset when disconnecting or beginning a connection to a different Station. Reconnect may retain the currently rendered frame until its replacement snapshot arrives.
- Re-announced readiness may cause the pending snapshot to be delivered again before acknowledgement. Snapshot application must remain atomic and safe under duplicate pre-ack delivery.
- The terminal reaches live state only after the WebView acknowledges snapshot application. WebSocket authentication and receipt of a Session Snapshot are necessary but not sufficient.
- Post-paint scrollback remains gated by snapshot acknowledgement. The startup change must preserve existing snapshot-before-scrollback ordering.
- Startup failure has a bounded deadline and records the last completed handshake stage. Expiry produces a renderer-specific failure with Retry rather than an indefinite loading overlay.
- Renderer Retry restarts the WebView readiness and snapshot-delivery handshake without deleting a valid Device Key binding.
- The terminal document keeps its offline asset model and network restrictions. Security policy changes are permitted only if required by a demonstrated native bridge constraint and must retain blocked external connections.
- Temporary `[native]` and `[web]` traces, static diagnostic pages, compatibility scripts, and stage overlays used during investigation are removed before completion.
- Development documentation notes that Metro cache invalidation can hide source changes during physical-device diagnosis, but cache clearing is not treated as the product fix.

## Testing Decisions

- Good tests assert externally observable behavior: a late-ready renderer receives the authenticated Session Snapshot, acknowledges it, and causes the loading state to become live. Tests do not assert private React refs, timer identities, or incidental callback counts.
- The primary automated seam is the Android terminal startup orchestration boundary combining Station connection events with a controllable WebView adapter. It reproduces the exact ordering from the report: the Station authenticates and publishes a Session Snapshot before the terminal renderer is ready; the renderer later announces readiness; the retained snapshot is delivered; snapshot application is acknowledged; the terminal becomes live.
- The same primary seam covers navigation from the Stations screen, where connection may begin before the terminal route mounts.
- The primary seam verifies that switching Station bindings clears retained snapshots and never paints the previous Station’s frame.
- The primary seam verifies bounded readiness retries, cleanup on unmount/reload, and renderer-specific timeout behavior.
- The primary seam verifies stable WebView source identity across connection, ownership, resize, and loading-state rerenders.
- The existing production terminal-document browser seam remains prior art for real xterm rendering, snapshot-to-frame conversion, reconnect overlays, scrollback, readable sizing, and message handling.
- The production-document seam adds a readiness-probe case that discards the initial ready message, sends a later probe, and observes a new ready response.
- The production-document seam applies a representative Session Snapshot after delayed readiness and verifies nonblank xterm content plus snapshot-applied acknowledgement.
- Existing WebSocket client tests remain the protocol seam for authentication, Session Snapshot ordering, duplicate/out-of-order rejection, reconnect, and scrollback gating.
- A focused latest-snapshot subscription test verifies that a subscriber joining after publication immediately receives the current snapshot and that reset prevents stale replay.
- Automated tests use deterministic fake time for readiness retries and deadlines; they do not sleep on wall-clock timing.
- The regression gate must include a fast command that fails on the pre-fix early-snapshot/late-renderer behavior and passes after the fix.
- Physical-device acceptance reproduces the original flow: start the CLI with Dev Tunnels, scan the QR, confirm both biometric prompts, observe a green Station connection, and verify that terminal content replaces “Loading Session…” without toggling network or reloading.
- Physical-device acceptance also selects an existing Station after app reload and confirms the terminal paints, because that navigation path exposed the early-snapshot race.
- Browser tests supplement but do not replace physical Android verification because the original browser seam passed while native WebView startup failed.

## Out of Scope

- Changing the Station pairing protocol, Device Key cryptography, or biometric requirements.
- Replacing Dev Tunnels or changing Tunnel provisioning and cleanup behavior.
- Replacing xterm with another renderer.
- Redesigning terminal controls, typography, selection, or size ownership beyond preserving their current behavior during startup.
- Changing Session Snapshot wire format or canonical screen contents.
- General React Native navigation refactoring unrelated to terminal startup.
- Solving arbitrary Metro, Expo Tunnel, or WSL file-watcher behavior as a product feature.
- Shipping permanent on-screen native/WebView diagnostic traces.
- Treating a cache-clearing development restart as the user-facing fix.
- iOS-specific WebView behavior.

## Further Notes

- The physical-device trace showed a connected Station and repeated native delivery of connection-state, resize, size-ownership, and Session Snapshot messages while the WebView reported `readyState=complete`, `bridge=true`, and `xterm=false`.
- A minimal static WebView page successfully received native messages and sent `ready` back, proving that react-native-webview itself and both bridge directions were available.
- The failure emerged only in the full terminal document and under startup ordering where xterm readiness lagged authenticated Session state.
- The investigation initially isolated snapshot replay and renderer readiness separately; live tracing demonstrated that both protections are required for a complete startup contract.
- Metro served stale transformed terminal-document code during parts of the investigation, so final acceptance must run from a clean development bundle. This observation explains inconsistent tracing but does not replace the application-level handshake fix.
- Existing terminal reliability work already defines Session Snapshot, snapshot-applied acknowledgement, retained reconnect frames, scrollback ordering, and Terminal Size Ownership. This spec tightens the Android startup boundary around those established concepts rather than introducing a second terminal-state model.
