# Soft Console as the cross-platform design system

UI for the website (and later Android chrome) follows Soft Console: terminal-inspired density without turning every surface into an emulator — warm paper, soft black ink, 1px rules, square controls, and dual typography (monospace for controls/status/commands; proportional for longer reading).

**Principles**

1. Quiet by default — color only for status, risk, or diffs.
2. Edges are structure — spacing and rules instead of cards, shadows, glow, or decorative rounding.
3. Terminal, not cosplay — monospace marks hierarchy and commands; body copy stays readable.
4. State is explicit — never color alone; pair with text or a symbol.
5. Real product evidence — screenshots must show authentic behavior.

Website is the first implementation; Android keeps its current UI until a deliberate migration that reuses the same semantic contract. Concrete tokens and component recipes live with the implementing surfaces (e.g. `website/app/globals.css`), not in ADRs.
