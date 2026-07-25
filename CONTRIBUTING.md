# Contributing

Thanks for helping with Mobily.

## Before you start

- Read the domain glossary in [`CONTEXT.md`](CONTEXT.md) (Station, Device Key, Session, …).
- Skim relevant [ADRs](docs/adr/) when changing pairing, tunnels, PTY/tmux, or the wire protocol.
- Follow [docs/development.md](docs/development.md) for install and the supported test gate.

## Pull requests

- Keep changes focused; prefer small PRs over mixed refactors + features.
- Match existing TypeScript style and naming.
- Run the supported gate from `docs/development.md` before requesting review.
- Update docs when behavior users see changes (README, CHANGELOG for releases).
- Do not commit secrets, local `.scratch/` notes, or machine-specific paths.

## Security

Report vulnerabilities privately — see [`SECURITY.md`](SECURITY.md).
