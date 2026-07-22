# Lock-screen alerts via foreground service; no FCM

Background and lock-screen presence use an Android foreground-service notification (API 26+), updated over the existing WebSocket connection. There is no Firebase Cloud Messaging (or other push) dependency.

Push would require a Mobily-operated or third-party relay and would not improve the connected-session case, where the phone already holds a live tunnel. A foreground service matches the product model: the phone is an active viewer of a Station Session, not a dormant push client.

**Consequences:** Alerts only work while the app's connection path is alive (or recovering). Offline push is an explicit non-goal unless a future ADR reopens it.
