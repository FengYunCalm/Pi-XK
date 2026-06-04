# Pi-XK Development Rules

## Purpose

Pi-XK is a focused fork of upstream Pi. Keep the fork maintainable, but do not preserve upstream governance, release automation, or branding unless it is required for compatibility.

## Communication

- Keep answers concise and technical.
- Answer direct questions before changing files.
- State whether you agree or disagree when responding to feedback or analysis.

## Code Quality

- Prefer the smallest correct change.
- Read relevant files before editing them.
- No `any` unless unavoidable.
- Use top-level imports only.
- Use erasable TypeScript syntax in root-checked source and tests.
- Do not remove intentional functionality unless the task explicitly calls for removal.
- Keep upstream package names and import paths unless the task is a planned rename migration.

## Commands

- After code changes, run `npm run check`.
- Do not run `npm run build` or broad tests unless the task requires it.
- For specific vitest files, run the narrowest relevant test command from the package root.
- For non-e2e broad coverage, use `./test.sh` from the repo root.
- Documentation-only changes do not require build or tests.

## Git

- Commit only files changed for the current task.
- Stage explicit paths; never use `git add .` or `git add -A`.
- Never use destructive git commands such as `git reset --hard`, `git clean -fd`, or `git checkout .` unless explicitly requested.
- Do not force push.

## Fork Policy

- `origin` is the Pi-XK repository.
- `upstream` is the official Pi repository and is used only for reviewed syncs.
- Do not reintroduce upstream GitHub Actions, issue gates, release publishing flows, or official project branding unless explicitly requested.
- Keep MIT license attribution intact.

## Verification

When reporting completion, state what changed, why, what was verified, and any remaining risk.
