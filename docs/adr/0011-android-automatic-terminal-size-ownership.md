---
status: accepted
---

# Android automatically owns terminal size while its Terminal screen is active

This decision supersedes the Android Terminal Size Ownership behavior in ADR 0004.

When the Android Terminal screen connects to a Session, it automatically claims
Terminal Size Ownership. After the Station grants ownership, Android derives a
readable columns-and-rows grid from the usable WebView viewport and the user's
terminal font size, then publishes that grid to the Session. There is no manual
layout toggle.

The production terminal viewport remains scrollable, so transient overflow,
zoomed content, and terminal history remain reachable. Changes to the viewport,
soft keyboard, or font size cause the owner to propose an updated readable
grid.

Leaving the Android Terminal screen releases ownership. The Station then
restores its own dimensions and becomes Terminal Size Owner again. A disconnect
also clears Android's local ownership state; Android claims again after a
successful reconnect.

## Consequences

- Full-screen terminal applications reflow to the phone instead of being
  uniformly shrunk from a wide Station grid.
- Terminal text remains at the configured readable font size.
- The shared Session, including a simultaneously attached Station terminal,
  temporarily uses the phone-shaped grid while Android's Terminal screen is
  active.
- Navigation to Git, Stations, or another screen restores the Station grid.
