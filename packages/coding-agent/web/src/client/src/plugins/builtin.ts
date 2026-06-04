import { corePlugin } from "./core";
import { PluginRegistry } from "./registry";
import { themePackPlugin } from "./themes";

export function createBuiltinPluginRegistry(): PluginRegistry {
	const registry = new PluginRegistry();
	registry.register({ id: "core", plugin: corePlugin });
	registry.register({ id: "themes", plugin: themePackPlugin });
	return registry;
}
