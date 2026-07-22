# Mobily Soft Console UI

Soft Console is Mobily's cross-platform design system for the website and Android app. It borrows the precision and density of a terminal without turning every surface into a terminal emulator: warm paper, soft black ink, exact rules, square controls, and typography that makes commands feel native.

The website is the first implementation. Android keeps its current UI until a later migration, but should use the same semantic contract when that work begins.

## Principles

1. **Quiet by default.** Neutral surfaces carry the interface. Color appears only when it communicates status, risk, or a diff.
2. **Edges are structure.** Use spacing and 1px rules instead of floating cards, shadows, glow, blur, gradients, or decorative rounding.
3. **Terminal, not cosplay.** Monospace type identifies controls, commands, status, and hierarchy. Longer explanations remain comfortably readable in a proportional face.
4. **State is explicit.** Never rely on color alone. Pair every semantic color with text, a symbol, or both.
5. **Real product evidence.** Screenshots and examples must show authentic Mobily behavior and must not imply features the product does not have.

## Foundations

### Color

| Token             | Value     | Use                                          |
| ----------------- | --------- | -------------------------------------------- |
| `canvas`          | `#F3F0E8` | Page and screen background                   |
| `surface`         | `#E9E6DE` | Secondary regions and quiet controls         |
| `surface-raised`  | `#DDD9CF` | Selected or emphasized neutral regions       |
| `ink`             | `#191917` | Primary text, strong rules, inverse surfaces |
| `muted`           | `#625F58` | Supporting text and metadata                 |
| `border`          | `#B9B5AA` | Dividers and default control borders         |
| `success`         | `#286748` | Connected, complete, addition                |
| `success-surface` | `#DDE9E0` | Success and addition background              |
| `warning`         | `#7A5918` | Reconnecting, attention                      |
| `warning-surface` | `#EEE5CF` | Warning background                           |
| `danger`          | `#963A34` | Error, offline, deletion                     |
| `danger-surface`  | `#F0DEDB` | Error and deletion background                |

`ink` and `muted` both meet WCAG AA for normal text on `canvas`. Semantic colors must always be paired with a label or symbol. Links and ordinary actions are monochrome, never semantic colors.

### Typography

- **Display and interface:** JetBrains Mono Variable, weights 500–700. Use for headings, navigation, buttons, labels, status, commands, numbers, and code.
- **Reading:** Geist, weights 400–600. Use for paragraphs, descriptions, help, and longer error explanations.
- Display headings use compact line-height and restrained negative tracking. Interface labels may use uppercase with moderate tracking; body copy uses sentence case.
- Minimum website body size is 16px. Small metadata may reach 11px only when it is supplementary and high contrast.
- Android should bundle the same two families through Expo Font rather than relying on platform aliases.

### Spacing and geometry

- Base unit: 4px.
- Preferred scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, and 128px.
- Default border: 1px solid `border`; strong separation uses `ink`.
- Default corner radius: 0. Circular status dots and the physical outline of a phone are the only routine exceptions.
- Minimum interactive target: 44×44px.
- Motion is short and functional: 160–240ms. Disable nonessential motion when reduced motion is requested.

## Component anatomy

### Button

An ink label inside a square 1px frame. Primary buttons invert to an `ink` background with `canvas` text. Hover and pressed states invert or move between neutral surfaces; disabled state keeps its label readable and reduces contrast without using opacity alone. Every variant keeps a 44px minimum target.

### Status

Compose a small semantic dot or symbol, an uppercase monospace label, and optional explanatory body copy. The label is mandatory because color never carries the state alone.

### Section heading

Use an indexed kicker such as `02 / CONTROL SURFACES`, a concise monospace heading, and optional Geist supporting copy. Align the heading to the site's structural rules rather than placing it in a card.

### Command block

Use an inverse ink surface, a visible prompt, a horizontally scrollable command, and a bordered Copy control with polite live feedback. Commands remain selectable and never wrap into an ambiguous value.

### Panel and list row

Use a transparent or neutral surface bounded by 1px rules. Selection is indicated by a strong ink border or inverse region, not a shadow. Rows keep content, state, and action in stable columns.

### Product frame

Show authentic screenshots without recoloring their contents. Website frames use a square editorial border around the screenshot; a rounded inner silhouette is allowed only when representing the physical phone.

### Form field

Place a monospace label above an ink-on-canvas input with a 1px border. Focus uses a 2px ink outline with a visible offset. Errors add a danger rule, explicit error text, and an accessibility relationship.

### Disclosure and modal

Disclosures are full-width ruled rows with a text `+`/`−` indicator. Modals use an ink-tinted backdrop and a square canvas panel; the title, content, and actions stay in a clear vertical sequence.

### Terminal controls

Controls sit in one bordered command bar with terse monospace labels. Active selection is inverse or strongly outlined. The terminal canvas itself stays dark and preserves ANSI color behavior; the surrounding application chrome uses Soft Console tokens.

### Git diff row

Code and line numbers use JetBrains Mono. Additions use `success` plus `success-surface`; deletions use `danger` plus `danger-surface`; hunks use a neutral raised surface. Prefix characters and labels remain visible so meaning survives without color.

## Android mapping

| Android primitive | Soft Console application                                             |
| ----------------- | -------------------------------------------------------------------- |
| `Screen`          | `canvas` background, safe-area ownership, consistent page gutters    |
| `TopBar`          | 1px bottom rule, monospace title/actions, explicit connection status |
| `Button`          | Square primary, secondary, and text variants with 44px targets       |
| `Status`          | Semantic dot/symbol plus text label                                  |
| `ListRow`         | Ruled row with stable content, metadata, state, and action columns   |
| `Field`           | Labeled square input with visible focus and error text               |
| `Modal`           | Canvas panel over an ink-tinted backdrop                             |
| `CommandBar`      | Horizontally resilient terminal controls with explicit active state  |
| `DiffRow`         | Monospace line grid with semantic surfaces and textual prefixes      |
| Loading           | Neutral status label and activity indicator; preserve layout         |
| Empty             | Direct explanation plus one next action                              |
| Error             | Danger heading, plain-language recovery detail, and explicit actions |

Recommended Android migration order: theme and fonts, shared primitives, scanner, Stations, terminal chrome, Git, then diff rendering. Product screenshots should be regenerated only after those screens use the final system.

## Accessibility and content

- Meet WCAG AA contrast and maintain visible keyboard focus.
- Use semantic headings, landmarks, labels, and live regions where state changes.
- Preserve focus trapping, Escape dismissal, and focus restoration in modal navigation.
- Keep Mobily domain terms exact: CLI, Station, Device Key, Device Binding ID, Session, Session Snapshot, and Tunnel.
- Be explicit that tmux-backed Sessions can survive CLI exit, while bare PTY sessions survive phone disconnects only while the CLI remains alive.
- Be explicit that Dev Tunnels may require first-run GitHub or Microsoft authentication and that local pinned TLS is the account-free same-network option.
