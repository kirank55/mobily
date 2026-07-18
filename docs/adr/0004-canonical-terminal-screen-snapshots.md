# Canonical terminal screen and snapshot-before-live delivery

## Decision

Each Session owns a backend-neutral canonical terminal screen. PTY output is
parsed by a headless xterm instance before it is delivered to viewers, so the
Session always has a current model of the visible grid independent of whether
the backend is a bare PTY or tmux.

After protocol negotiation and Device Key authentication, a new Android viewer
receives frames in this order:

1. `auth-ok`
2. the Session dimensions
3. one atomic `session-snapshot`
4. live `output` frames

The snapshot contains the exact visible rows and cells, Unicode cell widths,
foreground and background colors, text attributes, active normal/alternate
screen, cursor position, cursor visibility and cursor style. Snapshot frames
are bounded and validated by the shared protocol. This contract advances the
wire protocol to version 4; older peers fail version negotiation rather than
silently reverting to transcript replay.

Snapshot capture and terminal parsing use one ordered queue. Output received
before the capture is represented by the snapshot. Output received after the
capture boundary is delivered once as live output. Scrollback remains a
separate concern and is not replayed as part of initial screen delivery.

Android keeps its loading or reconnecting overlay visible until its production
xterm instance confirms that it parsed the snapshot. Live output queued after
the snapshot is then applied in wire order.

## Consequences

- An idle bare-PTY prompt is visible on first Android connection even when the
  PTY emits no new output.
- Full-screen and alternate-screen state can be reconstructed without replaying
  an unbounded terminal transcript.
- Local workstation output is delayed only until the canonical parser has
  consumed the corresponding PTY chunk.
- The Station and Android use matching xterm semantics, at the cost of a
  headless xterm dependency in the CLI.
- Snapshot size is proportional to the visible grid and is capped by both
  frame-size and cell-count limits.
