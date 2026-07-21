# Harden terminal startup across Station and app lifecycles

Status: ready-for-agent

## Parent

[Reliable Android Terminal Startup Handshake](../spec.md)

## What to build

Finish the reliable startup behavior across the user paths that previously exposed different timing: first pairing, selecting an existing Station, app reload, background restoration, reconnect, Station switching, and renderer-only Retry.

The completed flow must preserve the terminal document’s offline security boundary, remove all temporary native and WebView diagnostics, and provide development-stage logging without shipping trace overlays. Validate the clean implementation against the original physical-device reproduction using a fresh development bundle.

## Acceptance criteria

- [ ] First pairing paints terminal content after both biometric confirmations without requiring app reload, network toggling, or re-pairing.
- [ ] Selecting an existing Station paints terminal content when connection begins before terminal navigation completes.
- [ ] App reload followed by Station selection paints the terminal reliably.
- [ ] Background and foreground restoration cannot strand the terminal in loading when the Station remains authenticated.
- [ ] Reconnect retains the last frame, replaces it atomically with the new Session Snapshot, and returns to live.
- [ ] Switching Stations cannot display or acknowledge a Session Snapshot from the previous Station.
- [ ] Renderer Retry preserves a healthy Station connection and valid pairing while restarting only the renderer handshake.
- [ ] Authentication and Device Key failures continue to use their existing re-pair guidance and are not mislabeled as renderer failures.
- [ ] Terminal controls do not send actionable input before renderer readiness.
- [ ] The terminal document remains offline and cannot initiate external network requests.
- [ ] Readiness and snapshot recovery do not regress Terminal Size Ownership, readable grid sizing, input, selection, paste, or scrollback.
- [ ] Development logs identify the last completed startup stage without exposing sensitive pairing, Device Key, or Tunnel data.
- [ ] All temporary `[native]`, `[web]`, compatibility, static-page, and stage-trace UI used during diagnosis is removed.
- [ ] Automated Android unit and production-document tests pass from a clean bundle.
- [ ] Physical-device acceptance reproduces the original Dev Tunnels QR flow and confirms that terminal content replaces “Loading Session…” after the Station turns green.
- [ ] Physical-device acceptance also verifies the existing-Station path after app reload.
- [ ] Local run documentation records the clean-cache step required for trustworthy physical-device development verification without presenting cache clearing as the product fix.

## Blocked by

- [Issue 02](./02-paint-early-session-snapshot.md)
