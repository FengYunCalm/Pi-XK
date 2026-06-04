# Pi-XK

Pi-XK is a public fork of Pi focused on Web mode, runtime attach, and fork-local agent product work.

The repository keeps the upstream Pi package structure because the codebase still depends on those package names, import paths, and build contracts. The fork identity lives at the repository and product layer; package renaming should be handled as a separate migration if it becomes necessary.

## Relationship To Upstream

Pi-XK is derived from `earendil-works/pi` and remains MIT licensed.

Kept from upstream:

- Core source packages under `packages/`.
- Existing npm package scopes and TypeScript path aliases.
- Build, check, and test scripts required to keep the fork maintainable.
- The `upstream` git remote for selective reviewed merges.

Removed from upstream:

- GitHub Actions workflows and automatic repository gates.
- Upstream issue templates and contributor approval automation.
- Upstream README content that points users to official project governance or session-sharing programs.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/coding-agent` | CLI, TUI, RPC, Web mode, sessions, tools, and extensions |
| `packages/agent` | Core agent loop and tool execution runtime |
| `packages/ai` | Provider abstraction and model registry |
| `packages/tui` | Terminal UI library |

## Development

```bash
npm install --ignore-scripts
npm run check
npm run build
./test.sh
./pi-test.sh
```

Use `npm run check` after code changes. Run targeted tests for modified test coverage. Full builds and broad tests should be intentional because this fork still inherits the upstream monorepo size.

## Repository Policy

- `origin` is `FengYunCalm/Pi-XK`.
- `upstream` is kept only for reviewed syncs from `earendil-works/pi`.
- GitHub Actions are disabled for this repository.
- Releases and npm publishing are not automatic.
- Preserve upstream compatibility unless a change explicitly includes a package rename or public API migration.

## License

MIT. See [LICENSE](LICENSE).
