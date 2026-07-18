# Mobile Terminal Reliability and Temporary Tunnel Cleanup

Status: ready-for-agent

## Problem Statement

Mobily can authenticate an Android device and stream input successfully while still failing to present a usable terminal on the phone.

On initial connection or reconnect, Android may show an empty terminal even though input entered on the phone reaches the Session and is visible on the Station. The phone currently depends on terminal output emitted after it connects, so it has no reliable first frame when the Session is idle or already running a full-screen application.

Desktop-sized terminal geometry is also scaled into the phone viewport. This makes text too small and causes full-screen terminal applications such as OpenCode to lose useful visual detail compared with the Station. Android needs to participate in terminal sizing rather than merely shrinking a workstation-sized grid.

Separately, Temporary Tunnels created for Dev Tunnels sessions can remain after the CLI exits. Repeated leaked tunnels consume the account quota and eventually prevent new connections. Cleanup currently succeeds only when the normal disconnect path completes; it does not provide durable ownership tracking or recovery after a crash, forced exit, or failed deletion.

## Solution

Android will render an explicit, complete initial state for every authenticated Session. A backend-neutral canonical screen model on the Station will produce an atomic Session Snapshot containing the visible grid, styling, cursor state, and dimensions. The snapshot will arrive before live output, while bounded scrollback will load afterward without delaying first paint. Android will retain the last rendered frame under a connection-status overlay during transient reconnects.

While Android's terminal view is foregrounded, Android will become the Terminal Size Owner. It will derive rows and columns from the usable viewport at a readable font size and send those dimensions to the Station. The Station will arbitrate a single owner, granting ownership to the most recently foregrounded Android terminal. Other viewers remain interactive but cannot resize the Session. Ownership returns to the Station when the owning terminal is no longer visible, disconnects, or its ownership lease expires.

Mobily will treat every Dev Tunnel it creates as a Temporary Tunnel with durable ownership state. It will remove the tunnel during orderly shutdown and reconcile stale Mobily-owned tunnels before creating another one. Failed reconciliation will block creation of a new Dev Tunnel instead of compounding the leak. The first shutdown request will wait for cleanup for up to ten seconds; a second request or timeout will force exit while preserving recovery state for the next run.

## User Stories

1. As an Android user, I want the current Session screen to appear immediately after authentication, so that I do not see a blank terminal while the Session is healthy.
2. As an Android user, I want an explicit loading state before the first Session Snapshot arrives, so that an empty screen is not mistaken for a broken connection.
3. As an Android user, I want the last rendered terminal frame to remain visible during a transient reconnect, so that I retain context while the network recovers.
4. As an Android user, I want a reconnecting indicator over the retained frame, so that I know the displayed content may be temporarily stale.
5. As an Android user, I want the retained frame replaced atomically after reconnect, so that old and new terminal states are not visually mixed.
6. As an Android user, I want live output to begin only after the initial Session Snapshot is applied, so that terminal state is reconstructed in the correct order.
7. As an Android user, I want output produced while a snapshot is being prepared to appear afterward, so that no output is lost during connection.
8. As an Android user, I want repeated or delayed frames handled without duplicating terminal output, so that reconnect does not corrupt the display.
9. As an Android user, I want terminal colors, attributes, cursor state, Unicode, and full-screen layouts preserved, so that terminal applications retain their intended detail.
10. As an OpenCode user, I want the phone terminal to use dimensions suited to the phone, so that panels, prompts, and status information remain usable.
11. As an Android user, I want readable text to take priority over preserving a desktop-sized column count, so that I can operate the terminal without extreme scaling.
12. As an Android user, I want the terminal grid derived from the usable viewport, so that system insets, the keyboard, and the extra key row do not hide terminal content.
13. As an Android user, I want orientation changes to update the Session dimensions, so that the terminal uses available portrait and landscape space.
14. As an Android user, I want an explicit font-size change to recalculate the terminal grid, so that my readability preference remains authoritative.
15. As an Android user, I want pinch zoom to be visual only, so that zoom gestures do not continuously reflow a full-screen application.
16. As an Android user, I want resize events debounced, so that lifecycle and layout changes do not cause rapid terminal reflow.
17. As an Android user, I want size ownership only while the terminal view is visible, so that a background connection does not keep the Station at phone dimensions.
18. As a Station user, I want terminal size ownership returned after Android leaves the terminal, so that the workstation terminal again fits its own viewport.
19. As a Station user, I want a short release debounce, so that brief Android lifecycle transitions do not cause distracting resize churn.
20. As a user with multiple paired devices, I want one unambiguous Terminal Size Owner, so that devices do not fight over terminal dimensions.
21. As a user with multiple foregrounded devices, I want the most recently foregrounded Android terminal to receive ownership, so that the view I actively chose controls the layout.
22. As a non-owning viewer, I want to continue seeing output and entering commands, so that size arbitration does not make other clients read-only.
23. As a non-owning viewer, I want my resize requests ignored or rejected clearly, so that I cannot accidentally destabilize the owner's layout.
24. As a reconnecting owner, I want ownership re-established explicitly rather than assumed from an old connection, so that stale clients cannot retain control.
25. As an Android user, I want the visible screen painted before scrollback loads, so that a large history does not delay first paint.
26. As an Android user, I want bounded scrollback available after connection, so that I can inspect recent output without unbounded memory or network use.
27. As a tmux user, I want the same snapshot behavior as a bare PTY user, so that reconnect semantics do not depend on the Session backend.
28. As a native Windows user, I want a bare PTY Session to reconstruct its current screen, so that lack of tmux does not produce a blank reconnect.
29. As a CLI user, I want Mobily to record every Temporary Tunnel it creates, so that it can distinguish its resources from tunnels I created myself.
30. As a Dev Tunnels user, I want orderly CLI exit to delete the Temporary Tunnel, so that normal use does not consume my quota.
31. As a Dev Tunnels user, I want `Ctrl+C` to show that tunnel cleanup is in progress, so that a short shutdown delay is understandable.
32. As a Dev Tunnels user, I want the first shutdown request to wait no longer than ten seconds, so that cleanup cannot hang the CLI indefinitely.
33. As a Dev Tunnels user, I want a second shutdown request to force exit, so that I retain control when the service or helper is stuck.
34. As a Dev Tunnels user, I want forced exit to preserve the Temporary Tunnel record, so that cleanup can resume on the next run.
35. As a Dev Tunnels user, I want Mobily to reconcile its stale Temporary Tunnels before creating a new one, so that repeated crashes do not exhaust quota.
36. As a Dev Tunnels user, I want an already-deleted tunnel treated as successful cleanup, so that recovery is idempotent.
37. As a Dev Tunnels user, I want failed stale cleanup to block another Dev Tunnel creation, so that Mobily does not compound the leak.
38. As a Dev Tunnels user, I want a precise cleanup failure message containing the affected tunnel identity and recovery action, so that I can resolve service or authentication failures.
39. As a local-tunnel user, I want failed Dev Tunnel reconciliation not to prevent use of the secure local backend, so that remote-provider failure does not block LAN use.
40. As a user who created Dev Tunnels independently, I want Mobily never to delete unrecorded tunnels, so that recovery remains within Mobily's ownership boundary.
41. As a user running more than one Mobily CLI process, I want one process not to delete another live process's Temporary Tunnel, so that concurrent Sessions remain isolated.
42. As a maintainer, I want terminal and tunnel lifecycle failures covered by deterministic unattended tests, so that regressions are detected before release.

## Implementation Decisions

- The Session owns a backend-neutral canonical terminal screen model. PTY output and accepted resize events update this model regardless of whether the Session uses tmux or a bare PTY.
- A Session Snapshot is an atomic representation of the visible terminal grid, cell styling, cursor state, active screen, and grid dimensions. It is distinct from raw output replay and scrollback.
- The terminal protocol will add explicit snapshot and size-ownership interactions and will advance its negotiated protocol version. Unsupported peers will fail with the existing version-mismatch behavior rather than silently using partial semantics.
- Authentication completes before terminal state is delivered. The initial ordering is authentication success, ownership/size state, Session Snapshot, buffered live output, and then ordinary live streaming.
- Output emitted while a Session Snapshot is being serialized is buffered behind that snapshot. The transition to live output has a single ordering boundary with no loss or duplication.
- Scrollback is bounded and transported separately from the visible Session Snapshot. Scrollback transfer does not block first paint and cannot overwrite newer live state.
- Android distinguishes first connection from reconnect. First connection shows a loading state; reconnect retains the last frame with a reconnecting overlay until the replacement snapshot is applied.
- Android preserves general ANSI terminal behavior, styling, Unicode cell width, alternate-screen content, cursor state, and full-screen application output. Existing deliberate terminal-mouse handling must remain explicit and must not strip unrelated display controls.
- Android computes candidate rows and columns from the terminal viewport using a readable default font size. Insets, keyboard occupancy, and Mobily controls are excluded from the usable viewport.
- Orientation and explicit font-size changes may update the candidate grid. Pinch zoom remains a visual transform and does not emit terminal resize requests.
- Android sends explicit foreground ownership claims and releases. Native connection lifetime alone does not imply terminal visibility or size ownership.
- The Station arbitrates a single Terminal Size Owner. The most recently foregrounded authenticated Android terminal wins. Non-owning clients retain input and output access, but their resize requests do not change the Session grid.
- Ownership changes and viewport resizes are debounced. Ownership also has a lease or equivalent expiry so a disappeared client cannot hold the Session indefinitely.
- When no Android terminal owns the size, the Station terminal controls the grid. The Station's current dimensions are applied when ownership returns.
- The workstation mirrors the owner-selected grid while Android owns it. This intentionally revises the earlier workstation-authoritative sizing decision.
- Existing terminal-session architecture documentation must be updated to record Android size ownership, canonical screen state, snapshot ordering, and the resulting desktop reflow trade-off.
- A Temporary Tunnel has durable ownership metadata including its tunnel identity, owning CLI run identity, creation time, and lifecycle state.
- Ownership metadata is written atomically before a newly created tunnel is reported ready for use. A crash cannot leave a tunnel that Mobily has declared ready without a corresponding recovery record.
- Concurrent CLI runs have distinct live ownership leases. Startup recovery only deletes recorded tunnels whose owning run is no longer live.
- Dev Tunnel reconciliation runs before creation of another Dev Tunnel. A missing tunnel is treated as already cleaned up.
- Failed reconciliation preserves ownership metadata, reports a user-facing recovery error, and blocks new Dev Tunnel creation for that run. It does not block selection of another tunnel backend.
- Normal shutdown, handled termination signals, startup failure after tunnel creation, and uncaught top-level failure all enter the same idempotent cleanup coordinator.
- The first shutdown request stops accepting new work, displays cleanup progress, and gives tunnel deletion a ten-second deadline.
- A second shutdown request or deadline expiry force-exits. The durable ownership record remains for startup recovery.
- Successful deletion removes the corresponding ownership record atomically. Partial or ambiguous failure retains it.
- Recovery only acts on explicitly recorded Mobily-owned Temporary Tunnels. Bulk deletion and inference from account-wide tunnel listings are prohibited.
- Existing tunnel architecture documentation must be updated to record durable Temporary Tunnel ownership, recovery-before-create, bounded shutdown, and the reason new creation is blocked after failed reconciliation.

## Testing Decisions

- Tests assert externally observable contracts: rendered terminal state, protocol ordering, accepted ownership transitions, PTY dimensions, user-facing lifecycle states, tunnel inventory operations, and durable recovery outcomes. They do not assert private helper structure or incidental internal calls unless those calls are the provider boundary.
- The primary Session/WebSocket integration seam extends the existing end-to-end pairing test that uses a real PTY, real WebSocket server, protocol handshake, and authenticated client.
- The protocol integration test emits styled full-screen terminal output before a client attaches, then verifies that the first terminal payload is a complete Session Snapshot and that later live output follows without loss or duplication.
- The same integration seam reconnects after an idle period and verifies a non-empty current screen without requiring new PTY output.
- The protocol integration seam exercises ownership claims from multiple authenticated clients, confirms that the most recent foreground claim controls the PTY grid, verifies that non-owner resize requests do not change it, and confirms Station ownership restoration.
- The primary Android rendering seam drives the generated production terminal document in a headless browser. This is preferred over a second hand-built renderer because production and the browser harness already share the same document generator.
- Android rendering tests apply representative shell output and a full-screen TUI fixture with colors, Unicode, cursor movement, alternate-screen controls, clears, and redraws. Assertions inspect rendered text, dimensions, cursor visibility, and nonblank first paint.
- Android rendering tests cover portrait and landscape viewports, keyboard-reduced height, explicit font-size changes, and visual pinch zoom. They verify that readable viewport-derived dimensions are emitted only for qualifying layout changes.
- Android rendering tests simulate first connection and reconnect, verifying loading and reconnect overlays, retention of the old frame, and atomic replacement after the new snapshot.
- Existing Android WebSocket unit tests remain the protocol-validation seam for rejecting out-of-order, malformed, oversized, unauthenticated, or version-incompatible snapshot and ownership frames.
- The primary tunnel seam is an injected CLI lifecycle harness using a fake Dev Tunnels provider, fake durable ownership store, controllable process signals, and a deterministic clock.
- Tunnel lifecycle tests cover successful record/create/delete, normal exit, first and second shutdown requests, the ten-second deadline, crash-preserved records, startup reconciliation, missing remote tunnels, deletion failure, authentication failure, and provider rate limiting.
- Tunnel lifecycle tests cover concurrent run ownership so recovery never deletes a Temporary Tunnel with a live owner.
- Tunnel lifecycle tests verify that failed reconciliation prevents a new Dev Tunnel provider call while leaving non-Dev-Tunnel startup available.
- Existing Dev Tunnels backend tests remain useful prior art for helper interruption, explicit deletion, idempotent missing-tunnel handling, readiness timeout, quota errors, and forced helper termination.
- Each regression must have a fast deterministic command that fails on the pre-fix behavior and passes after implementation. Device-only manual verification supplements these commands but does not replace them.
- Manual acceptance testing on a physical Android device will cover an idle shell, reconnect, OpenCode in portrait and landscape, keyboard open and closed, background/foreground transitions, concurrent Station input, and CLI exit during an active Dev Tunnel.

## Out of Scope

- iOS support.
- Replacing xterm with a different terminal renderer solely for visual redesign.
- Independent terminal grids for each simultaneous viewer; a PTY has one active grid governed by the Terminal Size Owner.
- Making non-owning clients read-only.
- Persisting a bare PTY Session across CLI process death.
- Unlimited or permanently persisted scrollback.
- Synchronizing arbitrary terminal history beyond the configured bounded scrollback.
- Provider-wide cleanup commands such as deleting every tunnel in the user's account.
- Deleting, adopting, or modifying Dev Tunnels that Mobily did not record as its own.
- Changing cleanup semantics for tunnel backends that do not allocate remote resources.
- Automatically falling back from Dev Tunnels to another backend without an explicit user choice.
- General OpenCode-specific UI customization outside standards-compliant terminal rendering and mobile-appropriate sizing.

## Further Notes

- Repository tests covering Android terminal generation, Android WebSocket behavior, Dev Tunnels backend cleanup, and CLI session behavior were green before this specification. They do not currently reproduce the reported blank first frame, mobile TUI readability failure, or process-level tunnel leak.
- The local Dev Tunnels inventory contained two zero-port tunnels during investigation, confirming that stale remote resources exist even though backend-level disconnect tests pass.
- No Android Debug Bridge device was available from the workspace during investigation. The headless production-document seam is therefore required for unattended regression coverage, with a physical-device acceptance pass before release.
- The glossary now defines Terminal Size Owner, Session Snapshot, and Temporary Tunnel.
- The terminal-session and tunnel-backend ADRs describe earlier decisions that this work intentionally revises. They should be updated as part of implementation rather than silently contradicted.
