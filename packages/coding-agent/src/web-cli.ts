import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { getPackageDir, isBunBinary } from "./config.ts";
import { spawnProcess, waitForChildProcess } from "./utils/child-process.ts";

const require = createRequire(import.meta.url);

interface PiWebCommand {
	command: string;
	args: string[];
}

export function resolvePiWebCommand(packageDir = getPackageDir()): PiWebCommand {
	const sourceCli = join(packageDir, "web", "src", "cli.ts");
	if (!isBunBinary && existsSync(sourceCli)) {
		try {
			return { command: process.execPath, args: [require.resolve("tsx/cli"), sourceCli] };
		} catch {
			// Fall through to the built entrypoint for packaged installs without tsx.
		}
	}

	const distCli = isBunBinary ? join(packageDir, "web", "cli.js") : join(packageDir, "dist", "web", "cli.js");
	if (existsSync(distCli)) {
		return { command: isBunBinary ? "node" : process.execPath, args: [distCli] };
	}

	throw new Error(`PI WEB CLI entrypoint not found. Expected ${distCli}.`);
}

export async function handleWebCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "web") {
		return false;
	}

	try {
		const piWeb = resolvePiWebCommand();
		const child = spawnProcess(piWeb.command, [...piWeb.args, ...args.slice(1)], {
			stdio: "inherit",
			env: process.env,
		});
		const exitCode = await waitForChildProcess(child);
		if (exitCode !== 0) {
			process.exitCode = exitCode ?? 1;
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}

	return true;
}
