# AI agents are pure PTY passthrough

Mobily does not integrate with coding agents as first-class clients. Agent tools that already drive a terminal work through the same PTY Session as a human; there is no agent-specific protocol, prompt injection, or tool bridge inside Mobily.

Coupling to a particular agent stack would shrink the product to one workflow and force constant API chasing. Treating the Session as a dumb PTY keeps the boundary stable: if it works in a local terminal, it works on the phone.

**Consequences:** Features that require structured agent state (tool calls, plan UIs, approval gates) belong outside Mobily unless a future ADR deliberately widens scope.
