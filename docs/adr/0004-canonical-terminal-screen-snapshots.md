# Canonical terminal screen and snapshot-before-live delivery

## Decision

Each Session owns a backend-neutral canonical terminal screen. PTY output is
parsed by a headless xterm instance before it is delivered to viewers, so the
Session always has a current model of the visible grid independent of whether
the backend is a bare PTY or tmux.

Backends initialize that model through a dedicated visible-screen operation,
not through their scrollback API. A bare PTY reconstructs its current screen
from the bounded raw output retained during the current CLI run. A persisted
tmux Session uses an attributed `capture-pane` of the active visible screen
plus tmux's active-screen and cursor metadata. Newer tmux versions expose
cursor shape and blink state directly; older versions use tmux's
block-and-blink outer-client fallback. The result is converted to one complete
ANSI redraw before it enters the same canonical parser used for live output.

After protocol negotiation and Device Key authentication, a new Android viewer
receives frames in this order:

1. `auth-ok`
2. the requester-specific Terminal Size Owner state
3. the Session dimensions
4. one atomic `session-snapshot`
5. live `output` frames
6. after Android acknowledges first paint, ordered `session-scrollback` frames

The snapshot contains the exact visible rows and cells, Unicode cell widths,
foreground and background colors, text attributes, active normal/alternate
screen, cursor position, cursor visibility and cursor style. Snapshot frames
are bounded and validated by the shared protocol. This contract advances the
wire protocol to version 6 at the time of this decision (current
`PROTOCOL_VERSION` is 7 in `shared/src/protocol.ts`); older peers fail version
negotiation rather than silently reverting to transcript replay.

Snapshot capture and terminal parsing use one ordered queue. Output received
before the capture is represented by the snapshot. Output received after the
capture boundary is delivered once as live output. Scrollback remains a
separate concern and is not replayed as part of initial screen delivery.

The Mobily tmux client advertises RGB support and disables the session-local
tmux status row. This prevents tmux from reducing true color to a palette or
reserving a backend-only grid row, so full-screen applications expose the same
visible layout through tmux and a bare PTY.

Android keeps its loading or reconnecting overlay visible until its production
xterm instance confirms that it parsed the snapshot. Live output queued after
the snapshot is then applied in wire order.

That first-paint confirmation is also the release boundary for bounded
scrollback. The CLI freezes the backend-neutral history at the snapshot
boundary and does not begin its transfer until it receives
`session-snapshot-applied`. History uses one identified sequence of bounded
chunks. Android rejects a transfer that starts early, changes identity, skips
a sequence, or exceeds the complete-transfer limit; a repeated completed
transfer is ignored.

Android builds the history in a hidden production xterm instance, restores the
visible Session Snapshot on top of it, and then applies live output accumulated
during the rebuild. The completed terminal replaces the painted terminal in
one DOM swap and remains scrolled to the current screen. This makes recent
history available without delaying first paint, exposing an intermediate
replay, moving the viewer away from the current screen, or overwriting newer
output.

Terminal dimensions are governed by explicit Terminal Size Ownership rather
than connection lifetime. The Station owns dimensions by default and remains
the size owner for the shared Session grid. Android does not claim ownership
or emit Session resize frames; it scales the Station grid into the phone
viewport so the full desktop layout remains visible, and leaves readability
to user zoom and pan. The protocol still supports Android claim/release frames
for compatibility, but the Android app does not use them.

Pinch zoom and Fit are visual transforms only and do not reflow the Session;
when visual scale exceeds the viewport the stage stays pannable. Font-size
controls on Android adjust local rendering and re-fit the scaled view without
changing Station columns or rows.

## Consequences

- An idle bare-PTY prompt is visible on first Android connection even when the
  PTY emits no new output.
- Full-screen and alternate-screen state can be reconstructed without replaying
  an unbounded terminal transcript.
- Reattaching to an idle persisted tmux Session reconstructs its current
  attributed pane even if the attach client emits no timely redraw.
- Bounded history is available to workstation and Android attachments but is
  never treated as an atomic Session Snapshot.
- Local workstation output is delayed only until the canonical parser has
  consumed the corresponding PTY chunk.
- The Station and Android use matching xterm semantics, at the cost of a
  headless xterm dependency in the CLI.
- The Station remains Terminal Size Owner so workstation layouts stay intact
  while Android scales the full grid into the phone viewport.
- Android Fit and pinch zoom trade font size for a complete desktop frame;
  they do not reflow full-screen TUIs on the Station.
- Snapshot size is proportional to the visible grid and is capped by both
  frame-size and cell-count limits.
