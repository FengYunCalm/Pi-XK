# Pi-XK Coding Agent

This package contains the Pi-XK coding agent CLI, TUI, RPC mode, SDK surface, and bundled Web mode.

Pi-XK is a fork of upstream Pi. It keeps the upstream package name and import paths for compatibility, while repository identity and maintenance policy live in `FengYunCalm/Pi-XK`.

## What This Package Provides

- Interactive terminal coding agent.
- Print and JSON modes for one-shot command usage.
- RPC mode for process integration.
- SDK/runtime APIs for embedding.
- TypeScript extensions, skills, prompt templates, themes, and package resources.
- Bundled Web mode under `pi web`.

## Local Development

From the repository root:

```bash
npm install --ignore-scripts
npm run check
npm run build
./pi-test.sh
```

Run the CLI from source:

```bash
./pi-test.sh
```

Run Web mode from source after building:

```bash
pi web
```

## Documentation

- [Package docs](docs/index.md)
- [Providers](docs/providers.md)
- [Settings](docs/settings.md)
- [Extensions](docs/extensions.md)
- [RPC mode](docs/rpc.md)
- [Web mode docs](web/README.md)

## Fork Policy

- Keep upstream package names and import paths unless a planned rename migration is being performed.
- Keep MIT license attribution intact.
- Do not reintroduce upstream GitHub Actions, issue gates, release publishing flows, or official project branding unless explicitly requested.
- Treat upstream merges as reviewed syncs, not automatic updates.

## License

MIT.
