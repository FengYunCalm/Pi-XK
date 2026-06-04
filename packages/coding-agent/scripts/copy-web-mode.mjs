#!/usr/bin/env node
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const codingAgentDir = resolve(scriptDir, "..");
const piWebDir = resolve(codingAgentDir, "web");
const piWebDist = join(piWebDir, "dist");
const target = join(codingAgentDir, "dist", "web");

async function assertDirectory(path) {
	const info = await stat(path).catch(() => undefined);
	if (info?.isDirectory() !== true) {
		throw new Error(`Expected built PI WEB dist directory: ${path}`);
	}
}

await assertDirectory(piWebDist);
await mkdir(dirname(target), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(piWebDist, target, { recursive: true });
console.log(`Copied PI WEB mode to ${target}`);
