# Android client: Expo + xterm.js in a WebView

The Mobile Client is Android-first, built with React Native (Expo prebuild), targeting current API levels with fallbacks for older devices. The terminal renderer is `xterm.js` inside a React Native `WebView`, with a Termux-style extra key row (Esc, Ctrl, Alt, Tab, arrows) in that same WebView layer.

Native terminal widgets were rejected because they would fork Mobily from the web terminal ecosystem and make parity with workstation xterm behavior harder. A pure React Native canvas/text grid was rejected as a larger rewrite with weaker VT coverage. Expo was chosen over a bare React Native app to keep native module and release tooling manageable for a small project.

**Consequences:** WebView performance and bridge latency are first-class concerns; terminal chrome that must match ANSI behavior lives in the WebView document, not in React Native views.
