# Derive a readable Android grid from the mobile viewport

Status: resolved

## What to build

Make the foreground Android Terminal Size Owner choose a readable grid from the actual terminal viewport instead of shrinking a desktop-sized grid. Account for system insets, the soft keyboard, and Mobily controls. Orientation and explicit font-size changes may resize the Session; pinch zoom remains visual and must not continuously reflow full-screen applications.

The completed slice must make an OpenCode-like full-screen layout materially usable in portrait and landscape.

## Acceptance criteria

- [x] Android derives candidate rows and columns from the usable terminal viewport at a readable default font size.
- [x] System insets, the soft keyboard, and the extra key row are excluded from terminal space calculations.
- [x] Portrait and landscape orientation changes emit debounced owner resize requests.
- [x] An explicit font-size change recalculates the grid and persists the user's preference.
- [x] Pinch zoom changes visual scale without emitting PTY resize requests.
- [x] The terminal remains pannable or scrollable where visual zoom exceeds the viewport.
- [x] A production-terminal browser test verifies readable dimensions and preserved detail for an OpenCode-like fixture across representative phone viewports.
- [ ] Physical-device acceptance covers portrait, landscape, keyboard open/closed, font adjustment, and visual pinch zoom.

## Blocked by

- [Issue 05](./05-transfer-size-ownership-to-foreground-android.md)

## Answer

While Android owns Terminal Size, the production terminal document derives
cols/rows from `#viewport` (already excluding the extra key row; RN SafeArea
and keyboard resize exclude system chrome) at a readable default font size of
14px. Debounced proposals are posted to RN only when ownership is granted;
orientation and `A−`/`A+` font changes reflow the Session, while pinch/`zoom`
remain visual scale with a pannable stage.

Font size is persisted via SecureStore. ADR 0004 records the readable-grid
trade-off. Unattended coverage includes pure derivation/debounce unit tests,
font-preference persistence tests, and a Playwright production-document test
across portrait, landscape, keyboard-reduced height, font change, and pinch.
Physical-device acceptance remains a manual release gate.
