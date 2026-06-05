import type { PiWebPlugin, PiWebPluginRegistration } from "./types";
import { withPiWebTokenQuery } from "../api/auth";

interface PluginManifestEntry {
	id: string;
	module: string;
}

interface PluginManifest {
	plugins: PluginManifestEntry[];
}

export async function loadExternalPlugins(
	manifestUrl = "/pi-web-plugins/manifest.json",
): Promise<PiWebPluginRegistration[]> {
	const manifest = await fetchPluginManifest(manifestUrl);
	if (manifest === undefined) return [];

	const registrations: PiWebPluginRegistration[] = [];
	for (const entry of manifest.plugins) {
		try {
			const moduleUrl = pluginModuleUrl(entry.module, manifestUrl);
			const module: unknown = await import(/* @vite-ignore */ moduleUrl);
			const plugin = parsePluginModule(module, moduleUrl);
			registrations.push({ id: entry.id, plugin });
		} catch (error) {
			console.warn(`Failed to load PI WEB plugin ${entry.module}`, error);
		}
	}
	return registrations;
}

function pluginModuleUrl(modulePath: string, manifestUrl: string): string {
	const moduleUrl = sameOriginPluginUrl(modulePath, new URL(manifestUrl, window.location.href), "module");
	return withPiWebTokenQuery(moduleUrl.toString());
}

async function fetchPluginManifest(manifestUrl: string): Promise<PluginManifest | undefined> {
	const response = await fetch(withPiWebTokenQuery(sameOriginPluginUrl(manifestUrl, window.location.href, "manifest").toString()), {
		cache: "no-store",
	});
	if (response.status === 404) return undefined;
	if (!response.ok) throw new Error(`Failed to load plugin manifest: ${response.statusText}`);
	return parseManifest(await response.json());
}

function sameOriginPluginUrl(path: string, base: string | URL, kind: "manifest" | "module"): URL {
	const url = new URL(path, base);
	if (url.origin !== window.location.origin) throw new Error(`Cross-origin PI WEB plugin ${kind} is not allowed: ${url.origin}`);
	return url;
}

function parseManifest(value: unknown): PluginManifest {
	if (!isRecord(value) || !Array.isArray(value["plugins"])) throw new Error("Invalid plugin manifest");
	return {
		plugins: value["plugins"].map((entry) => {
			if (
				!isRecord(entry) ||
				typeof entry["id"] !== "string" ||
				entry["id"] === "" ||
				typeof entry["module"] !== "string" ||
				entry["module"] === ""
			)
				throw new Error("Invalid plugin manifest entry");
			return { id: entry["id"], module: entry["module"] };
		}),
	};
}

function parsePluginModule(module: unknown, moduleUrl: string): PiWebPlugin {
	if (!isRecord(module)) throw new Error(`Plugin module ${moduleUrl} did not export an object`);
	const plugin = module["default"];
	if (!isPiWebPlugin(plugin)) throw new Error(`Plugin module ${moduleUrl} default export is not a PiWebPlugin`);
	return plugin;
}

function isPiWebPlugin(value: unknown): value is PiWebPlugin {
	return (
		isRecord(value) &&
		value["apiVersion"] === 1 &&
		typeof value["name"] === "string" &&
		typeof value["activate"] === "function"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
