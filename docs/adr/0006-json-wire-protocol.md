# JSON wire protocol; binary frames deferred

Station ↔ Mobile Client frames use JSON schemas in `shared/`. Binary framing is deferred unless profiling shows JSON encode/decode or payload size is a real bottleneck.

JSON keeps the protocol easy to inspect, test, and evolve across CLI and Android without a second codec. A custom binary format would be harder to reverse and harder to debug for little proven gain at current session sizes.

**Consequences:** Frame types and validation live in the shared package. Revisit only with measured evidence, not premature optimization.
