#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPiWebConfigPath, examplePiWebConfig } from "./config.ts";
import { packageVersion, printPiWebVersionReport } from "./piWebVersionReport.ts";
import {
	checkNodePtyDarwinSpawnHelper,
	formatNodePtyDarwinSpawnHelperCheck,
} from "./server/diagnostics/nodePtySpawnHelper.ts";

interface ForegroundOptions {
	host: string;
	port: string;
	config?: string;
}

type Entrypoint = "server" | "sessiond";

function parseForegroundOptions(args: string[]): ForegroundOptions {
	const options: ForegroundOptions = { host: "127.0.0.1", port: "8504" };
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (arg === "--host") {
			const value = args[i + 1];
			if (value === undefined) throw new Error("--host requires a value");
			options.host = value;
			i += 1;
		} else if (arg.startsWith("--host=")) {
			options.host = arg.slice("--host=".length);
		} else if (arg === "--port") {
			const value = args[i + 1];
			if (value === undefined) throw new Error("--port requires a value");
			options.port = value;
			i += 1;
		} else if (arg.startsWith("--port=")) {
			options.port = arg.slice("--port=".length);
		} else if (arg === "--config") {
			const value = args[i + 1];
			if (value === undefined) throw new Error("--config requires a value");
			options.config = value;
			i += 1;
		} else if (arg.startsWith("--config=")) {
			options.config = arg.slice("--config=".length);
		} else {
			throw new Error(`Unknown web option: ${arg}`);
		}
	}
	return options;
}

function runtimeRootPath(): string {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	if (existsSync(join(moduleDir, "server", "index.js"))) return moduleDir;
	return join(dirname(moduleDir), "dist");
}

function packageEntrypointPath(entrypoint: Entrypoint): string {
	return join(runtimeRootPath(), "server", entrypoint === "server" ? "index.js" : "sessiond.js");
}

async function writeInitialConfig(options: ForegroundOptions): Promise<string> {
	const configPath = options.config === undefined ? defaultPiWebConfigPath() : resolve(options.config);
	await mkdir(dirname(configPath), { recursive: true });
	if (!existsSync(configPath)) {
		await writeFile(configPath, examplePiWebConfig({ host: options.host, port: Number(options.port) }));
	}
	return configPath;
}

async function runForeground(args: string[]): Promise<void> {
	const options = parseForegroundOptions(args);
	const configPath = await writeInitialConfig(options);
	const host = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
	const env = {
		...process.env,
		PI_WEB_CONFIG: configPath,
		PI_WEB_HOST: options.host,
		PI_WEB_PORT: options.port,
	};
	const sessiond = spawn(process.execPath, [packageEntrypointPath("sessiond")], { stdio: "inherit", env });
	const web = spawn(process.execPath, [packageEntrypointPath("server")], { stdio: "inherit", env });
	console.log(`Pi Web mode running at http://${host}:${options.port}`);
	console.log("Press Ctrl-C to stop.");
	process.exitCode = await waitForForegroundProcesses([sessiond, web]);
}

async function waitForForegroundProcesses(processes: ChildProcess[]): Promise<number> {
	let stopping = false;
	const stop = (): void => {
		if (stopping) return;
		stopping = true;
		for (const child of processes) {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
		}
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		return await new Promise<number>((resolve) => {
			for (const child of processes) {
				child.once("error", (error) => {
					console.error(error.message);
					stop();
					resolve(1);
				});
				child.once("exit", (code, signal) => {
					stop();
					resolve(signal === "SIGTERM" ? 0 : (code ?? 1));
				});
			}
		});
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	}
}

async function doctor(): Promise<void> {
	console.log(`Platform: ${platformLabel()}`);
	console.log("Run mode: foreground terminal process");
	console.log("");
	await printPiWebVersionReport();
	console.log("\nDoctor checks:");
	let ok = true;
	ok = printCheck("node >= 22", Number(process.versions.node.split(".")[0]) >= 22) && ok;
	ok = printCheck("bundled web server entrypoint", existsSync(packageEntrypointPath("server"))) && ok;
	ok = printCheck("bundled session entrypoint", existsSync(packageEntrypointPath("sessiond"))) && ok;
	const nodePtySpawnHelperOk = printNodePtyDarwinSpawnHelperCheck();
	if (!ok || !nodePtySpawnHelperOk) process.exitCode = 1;
}

function printCheck(label: string, ok: boolean): boolean {
	console.log(`${ok ? "✓" : "✗"} ${label}`);
	return ok;
}

function printNodePtyDarwinSpawnHelperCheck(): boolean {
	const result = formatNodePtyDarwinSpawnHelperCheck(checkNodePtyDarwinSpawnHelper());
	for (const line of result.lines) console.log(line);
	return result.ok;
}

function platformLabel(): string {
	if (process.platform === "darwin") return "macOS";
	if (process.platform === "linux") return "Linux";
	if (process.platform === "win32") return "Windows";
	return process.platform;
}

function help(): void {
	console.log(`Pi Web mode

Usage:
  pi web [--host 127.0.0.1] [--port 8504] [--config ~/.config/pi-web/config.json]
  pi web doctor
  pi web version

Start Web mode:
  pi web
`);
}

function unsupportedServiceCommand(command: string): never {
	throw new Error(`\`pi web ${command}\` is no longer supported. Pi Web mode runs in the current terminal; use \`pi web\`.`);
}

export async function runPiWebCli(args: string[] = process.argv.slice(2)): Promise<void> {
	const [command, ...commandArgs] = args;
	if (command === undefined) await runForeground([]);
	else if (command === "run" || command === "serve") await runForeground(commandArgs);
	else if (command === "doctor") await doctor();
	else if (command === "version") await printPiWebVersionReport();
	else if (command === "--version" || command === "-v") console.log(packageVersion());
	else if (command === "help" || command === "--help" || command === "-h") help();
	else if (command.startsWith("--")) await runForeground(args);
	else if (isLegacyServiceCommand(command)) unsupportedServiceCommand(command);
	else throw new Error(`Unknown command: ${command}`);
}

function isLegacyServiceCommand(command: string): boolean {
	return ["install", "uninstall", "start", "stop", "restart", "status", "logs"].includes(command);
}

function realpathOrResolve(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function isDirectCliExecution(): boolean {
	const entrypoint = process.argv[1];
	return (
		entrypoint !== undefined && realpathOrResolve(entrypoint) === realpathOrResolve(fileURLToPath(import.meta.url))
	);
}

if (isDirectCliExecution()) {
	runPiWebCli().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
