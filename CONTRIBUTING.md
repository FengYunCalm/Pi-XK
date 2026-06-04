# Contributing To Pi-XK

Pi-XK is maintained as a focused fork, not as the official Pi upstream.

## Scope

Changes should support this fork's current direction:

- Web mode.
- Runtime attach.
- Agent product integration.
- Local maintainability.

Avoid broad upstream-style refactors unless they are needed for the fork's product work.

## Development Checks

For code changes:

```bash
npm run check
```

For test changes, run the specific tests you changed or the narrowest relevant suite. Use `./test.sh` for non-e2e repo-wide test coverage when broad validation is needed.

## Pull Requests

GitHub issue and PR gates from upstream are not used here. Keep PRs small, explain the behavior change, and include verification notes.

## Upstream Syncs

Upstream changes from `earendil-works/pi` should be merged selectively. Review compatibility with Pi-XK Web mode and runtime attach behavior before accepting upstream release or governance changes.
