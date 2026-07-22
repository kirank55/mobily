# Domain docs

How the engineering skills should consume this repository’s domain documentation when exploring the codebase.

## What belongs in `docs/`

`docs/` holds durable architecture and decisions only — primarily `docs/adr/`.
It must not hold roadmaps, task checklists, runbooks, bug lists, research dumps,
or code walkthroughs. Those belong in `README.md`, `SECURITY.md`, package
READMEs, or `.scratch/` working notes.

## Before exploring, read these

- `CONTEXT.md` at the repository root
- Relevant ADRs under `docs/adr/`

If either location does not exist, proceed silently. Do not flag its absence or suggest creating it upfront. The domain-modeling workflows create documentation lazily when terms or decisions are resolved.

## File structure

This repository uses a single-context layout:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
├── cli/
├── shared/
├── android/
└── website/
```

## Use the glossary’s vocabulary

When output names a domain concept—in an issue title, refactor proposal, hypothesis, or test name—use the term defined in `CONTEXT.md`. Do not drift to synonyms that the glossary explicitly avoids.

If a needed concept is absent from the glossary, reconsider whether the language belongs to the project or note the gap for domain modeling.

## Flag ADR conflicts

If output contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
