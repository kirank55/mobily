# Derive a readable Android grid from the mobile viewport

Status: ready-for-agent

## What to build

Make the foreground Android Terminal Size Owner choose a readable grid from the actual terminal viewport instead of shrinking a desktop-sized grid. Account for system insets, the soft keyboard, and Mobily controls. Orientation and explicit font-size changes may resize the Session; pinch zoom remains visual and must not continuously reflow full-screen applications.

The completed slice must make an OpenCode-like full-screen layout materially usable in portrait and landscape.

## Acceptance criteria

- [ ] Android derives candidate rows and columns from the usable terminal viewport at a readable default font size.
- [ ] System insets, the soft keyboard, and the extra key row are excluded from terminal space calculations.
- [ ] Portrait and landscape orientation changes emit debounced owner resize requests.
- [ ] An explicit font-size change recalculates the grid and persists the user's preference.
- [ ] Pinch zoom changes visual scale without emitting PTY resize requests.
- [ ] The terminal remains pannable or scrollable where visual zoom exceeds the viewport.
- [ ] A production-terminal browser test verifies readable dimensions and preserved detail for an OpenCode-like fixture across representative phone viewports.
- [ ] Physical-device acceptance covers portrait, landscape, keyboard open/closed, font adjustment, and visual pinch zoom.

## Blocked by

- [Issue 05](./05-transfer-size-ownership-to-foreground-android.md)
