#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
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
	hostname?: string;
	port: string;
	config?: string;
	printLogs: boolean;
}

type Entrypoint = "server" | "sessiond";

export function parseForegroundOptions(args: string[]): ForegroundOptions {
	const options: ForegroundOptions = { host: "127.0.0.1", port: "8504", printLogs: false };
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (arg === "--print-logs") {
			options.printLogs = true;
		} else if (arg === "--host") {
			const value = args[i + 1];
			if (value === undefined) throw new Error("--host requires a value");
			options.host = value;
			i += 1;
		} else if (arg.startsWith("--host=")) {
			options.host = arg.slice("--host=".length);
		} else if (arg === "--hostname") {
			const value = args[i + 1];
			if (value === undefined) throw new Error("--hostname requires a value");
			options.hostname = value;
			i += 1;
		} else if (arg.startsWith("--hostname=")) {
			options.hostname = arg.slice("--hostname=".length);
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

export function webInterfaceUrl(options: Pick<ForegroundOptions, "host" | "hostname" | "port">): string {
	const browserHost = options.hostname ?? localBrowserHost(options.host);
	return formatWebInterfaceUrl(browserHost, options.port);
}

export function webInterfaceProbeUrl(options: Pick<ForegroundOptions, "host" | "port">): string {
	return formatWebInterfaceUrl(localBrowserHost(options.host), options.port);
}

function localBrowserHost(host: string): string {
	return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function formatWebInterfaceUrl(browserHost: string, port: string): string {
	const formattedHost = browserHost.includes(":") && !browserHost.startsWith("[") ? `[${browserHost}]` : browserHost;
	return `http://${formattedHost}:${port}/`;
}

export function webInterfaceUrlWithToken(options: Pick<ForegroundOptions, "host" | "hostname" | "port">, token?: string): string {
	const url = new URL(webInterfaceUrl(options));
	if (token !== undefined) url.searchParams.set("token", token);
	return url.toString();
}

function webInterfaceProbeUrlWithToken(options: Pick<ForegroundOptions, "host" | "port">, token?: string): string {
	const url = new URL(webInterfaceProbeUrl(options));
	if (token !== undefined) url.searchParams.set("token", token);
	return url.toString();
}

export function browserOpenCommand(
	url: string,
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
	if (platform === "darwin") return { command: "open", args: [url] };
	if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
	if (isWslEnvironment(env)) return { command: "cmd.exe", args: ["/c", "start", "", url] };
	return { command: "xdg-open", args: [url] };
}

function isWslEnvironment(env: NodeJS.ProcessEnv): boolean {
	return env["WSL_DISTRO_NAME"] !== undefined || env["WSL_INTEROP"] !== undefined;
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
	await assertPortAvailable(options.host, options.port);
	const configPath = await writeInitialConfig(options);
	const token = process.env["PI_WEB_TOKEN"] ?? (isLocalAccess(options) ? undefined : generateAccessToken());
	const url = webInterfaceUrlWithToken(options, token);
	const probeUrl = webInterfaceProbeUrlWithToken(options, token);
	const sessiondRuntimeDir = await mkdtemp(join(tmpdir(), "pi-web-sessiond-"));
	const env = {
		...process.env,
		PI_WEB_CONFIG: configPath,
		PI_WEB_HOST: options.host,
		PI_WEB_PORT: options.port,
		PI_WEB_SESSIOND_SOCKET: join(sessiondRuntimeDir, "sessiond.sock"),
		...(token === undefined ? {} : { PI_WEB_TOKEN: token }),
	};
	const stdio: StdioOptions = options.printLogs ? "inherit" : "ignore";
	const sessiond = spawn(process.execPath, [packageEntrypointPath("sessiond")], { stdio, env });
	const web = spawn(process.execPath, [packageEntrypointPath("server")], { stdio, env });
	const processes = [sessiond, web];
	try {
		try {
			await waitForWebReady(probeUrl, processes);
		} catch (error) {
			stopProcesses(processes);
			throw error;
		}
		openBrowser(options.hostname === undefined ? url : probeUrl);
		console.log(`Web interface: ${url}`);
		if (options.hostname !== undefined) console.log(`Local access: ${probeUrl}`);
		process.exitCode = await waitForForegroundProcesses(processes);
	} finally {
		await rm(sessiondRuntimeDir, { recursive: true, force: true });
	}
}

export async function assertPortAvailable(host: string, port: string): Promise<void> {
	const parsedPort = Number.parseInt(port, 10);
	if (!Number.isFinite(parsedPort)) throw new Error(`Invalid web port: ${port}`);
	await new Promise<void>((resolvePromise, reject) => {
		const server = createServer();
		server.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE") {
				reject(new Error(`Port ${port} is already in use on ${host}. Choose another port with \`pi web --port <port>\`.`));
				return;
			}
			reject(error);
		});
		server.listen({ host, port: parsedPort }, () => {
			server.close((error) => {
				if (error !== undefined) reject(error);
				else resolvePromise();
			});
		});
	});
}

function generateAccessToken(): string {
	return randomBytes(24).toString("base64url");
}

function isLocalHost(host: string): boolean {
	return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function isLocalAccess(options: Pick<ForegroundOptions, "host" | "hostname">): boolean {
	return isLocalHost(options.host) && (options.hostname === undefined || isLocalHost(options.hostname));
}

function openBrowser(url: string): void {
	const { command, args } = browserOpenCommand(url);
	try {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.once("error", () => undefined);
		child.unref();
	} catch {
		// The URL is printed for manual opening when no browser opener is available.
	}
}

async function waitForWebReady(url: string, processes: ChildProcess[], timeoutMs = 10_000): Promise<void> {
	const statusUrl = statusProbeUrl(url);
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const exited = processes.find((child) => child.exitCode !== null || child.signalCode !== null);
		if (exited !== undefined) {
			throw new Error("Pi Web failed to start. Re-run with `pi web --print-logs` to inspect startup logs.");
		}

		try {
			const response = await fetch(statusUrl);
			if (response.ok) return;
		} catch {
			// Server is not listening yet.
		}
		await sleep(150);
	}
	throw new Error("Timed out waiting for Pi Web to start. Re-run with `pi web --print-logs` to inspect startup logs.");
}

function statusProbeUrl(url: string): string {
	const source = new URL(url);
	const statusUrl = new URL("/api/pi-web/version", source);
	const token = source.searchParams.get("token");
	if (token !== null) statusUrl.searchParams.set("token", token);
	return statusUrl.toString();
}

function stopProcesses(processes: ChildProcess[]): void {
	for (const child of processes) {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForForegroundProcesses(processes: ChildProcess[]): Promise<number> {
	let stopping = false;
	const stop = (): void => {
		if (stopping) return;
		stopping = true;
		stopProcesses(processes);
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
	console.log("Run mode: foreground terminal process, silent logs by default");
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
	pi web [--host 127.0.0.1] [--hostname <name-or-ip>] [--port 8504] [--config ~/.config/pi-web/config.json] [--print-logs]
	pi web doctor
	pi web version

Start Web mode:
	pi web

Options:
	--host         listen address, for example 127.0.0.1 or 0.0.0.0
	--hostname     browser/display host, for example a Tailscale hostname or 100.x address
	--port         listen port
	--config       config file path
	--print-logs   print server and session logs to stderr/stdout

Tailscale example:
	pi web --host 0.0.0.0 --hostname your-machine.tailnet.ts.net
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
