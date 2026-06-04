import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.ts";
import type {
	PiWebComponentStatus,
	PiWebInstallationInfo,
	PiWebReleaseStatus,
	PiWebServiceComponent,
	PiWebStatusMessage,
	PiWebStatusResponse,
	PiWebVersionResponse,
} from "../shared/apiTypes.ts";
import { parsePiWebComponentStatus } from "../shared/piWebStatusParsing.ts";

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const PI_WEB_PACKAGE_NAME = PI_PACKAGE_NAME;
const DEFAULT_VERSION = "0.0.0-dev";
const LATEST_RELEASE_CACHE_MS = 6 * 60 * 60 * 1000;
const VERSION_CHECK_TIMEOUT_MS = 5000;

interface PackageInfo {
	name: string;
	version: string;
	path: string;
}

let latestReleaseCache: { checkedAtMs: number; latestVersion?: string; error?: string } | undefined;

const runtimePackageInfo = readPackageInfoSync();

export async function getPiWebComponentStatus(component: PiWebServiceComponent): Promise<PiWebComponentStatus> {
	const [installed, installation] = await Promise.all([readInstalledPackageInfo(), detectPiWebInstallation()]);
	const runtimeVersion = runtimePackageInfo?.version ?? DEFAULT_VERSION;
	const installedVersion = installed?.version;
	return {
		component,
		label: component === "web" ? "Web/UI" : "Session daemon",
		runtimeVersion,
		...(installedVersion === undefined ? {} : { installedVersion }),
		stale: isInstalledVersionNewer(installedVersion, runtimeVersion),
		available: true,
		installation,
	};
}

export async function getPiWebVersionStatus(daemon = new SessionDaemonClient()): Promise<PiWebVersionResponse> {
	const [web, sessiond] = await Promise.all([getPiWebComponentStatus("web"), getSessiondComponentStatus(daemon)]);
	return {
		packageName: PI_WEB_PACKAGE_NAME,
		generatedAt: new Date().toISOString(),
		components: { web, sessiond },
	};
}

export async function getPiWebStatus(daemon = new SessionDaemonClient()): Promise<PiWebStatusResponse> {
	const versionStatus = await getPiWebVersionStatus(daemon);
	const { web, sessiond } = versionStatus.components;
	const release = await getLatestReleaseStatus(web.installedVersion ?? web.runtimeVersion ?? DEFAULT_VERSION);
	const components = { web, sessiond };
	const commands = commandsFor(components);
	const messages = buildMessages(components, release, commands);
	return {
		...versionStatus,
		release,
		commands,
		messages,
	};
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = parsePackageVersion(leftVersion);
	const right = parsePackageVersion(rightVersion);
	if (left === undefined || right === undefined) return undefined;
	if (left.major !== right.major) return left.major - right.major;
	if (left.minor !== right.minor) return left.minor - right.minor;
	if (left.patch !== right.patch) return left.patch - right.patch;
	if (left.prerelease === right.prerelease) return 0;
	if (left.prerelease === undefined) return 1;
	if (right.prerelease === undefined) return -1;
	return left.prerelease.localeCompare(right.prerelease);
}

function readPackageInfoSync(): PackageInfo | undefined {
	const path = packageJsonPath();
	try {
		return parsePackageInfo(JSON.parse(readFileSync(path, "utf8")), path);
	} catch {
		return undefined;
	}
}

async function readInstalledPackageInfo(): Promise<PackageInfo | undefined> {
	const path = packageJsonPath();
	try {
		await stat(path);
		return parsePackageInfo(JSON.parse(await readFile(path, "utf8")), path);
	} catch {
		return undefined;
	}
}

function packageJsonPath(): string {
	const serverDir = dirname(fileURLToPath(import.meta.url));
	const embeddedPackageJson = join(serverDir, "..", "package.json");
	return existsSync(embeddedPackageJson) ? embeddedPackageJson : join(serverDir, "..", "..", "package.json");
}

function parsePackageInfo(value: unknown, path: string): PackageInfo | undefined {
	if (!isRecord(value)) return undefined;
	const name = value["name"];
	const version = value["version"];
	if (typeof name !== "string" || name === "" || typeof version !== "string" || version === "") return undefined;
	return { name, version, path };
}

async function detectPiWebInstallation(): Promise<PiWebInstallationInfo> {
	const root = packageRootPath();
	const realRoot = await realPathOrSelf(root);
	const piPackage = await detectPiPackageInstallation(realRoot, root);
	if (piPackage !== undefined) return piPackage;
	const npmGlobal = await detectNpmGlobalInstallation(realRoot, root);
	if (npmGlobal !== undefined) return npmGlobal;
	return { kind: "local", path: root };
}

async function detectPiPackageInstallation(
	realRoot: string,
	displayPath: string,
): Promise<PiWebInstallationInfo | undefined> {
	try {
		const agentDir = getAgentDir();
		const packageManager = new DefaultPackageManager({
			cwd: process.cwd(),
			agentDir,
			settingsManager: SettingsManager.create(process.cwd(), agentDir),
		});
		for (const configuredPackage of packageManager.listConfiguredPackages()) {
			const installedPath =
				configuredPackage.installedPath ??
				packageManager.getInstalledPath(configuredPackage.source, configuredPackage.scope);
			if (installedPath === undefined) continue;
			const realInstalledPath = await realPathOrSelf(installedPath);
			if (isSameOrWithin(realInstalledPath, realRoot) || isSameOrWithin(realRoot, realInstalledPath)) {
				return {
					kind: "pi-package",
					path: displayPath,
					source: configuredPackage.source,
					scope: configuredPackage.scope,
				};
			}
		}
	} catch {
		return undefined;
	}
	return undefined;
}

async function detectNpmGlobalInstallation(
	realRoot: string,
	displayPath: string,
): Promise<PiWebInstallationInfo | undefined> {
	const npmRoot = npmGlobalRoot();
	if (npmRoot === undefined) return undefined;
	const realNpmRoot = await realPathOrSelf(npmRoot);
	if (!isSameOrWithin(realNpmRoot, realRoot)) return undefined;
	return { kind: "npm-global", path: displayPath, npmRoot };
}

function npmGlobalRoot(): string | undefined {
	const result = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
	if (result.status !== 0) return undefined;
	const root = result.stdout.trim();
	return root === "" ? undefined : root;
}

function packageRootPath(): string {
	return dirname(packageJsonPath());
}

async function realPathOrSelf(path: string): Promise<string> {
	return realpath(path).catch(() => resolve(path));
}

function isSameOrWithin(parent: string, candidate: string): boolean {
	const rel = relative(parent, candidate);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

async function getSessiondComponentStatus(daemon: SessionDaemonClient): Promise<PiWebComponentStatus> {
	try {
		const upstream = await daemon.request("GET", "/health");
		if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
			return unavailableSessiond(`health check returned HTTP ${String(upstream.statusCode)}`);
		}
		const parsed: unknown = upstream.body === "" ? undefined : JSON.parse(upstream.body);
		const version = isRecord(parsed) ? parsed["version"] : undefined;
		const component = parsePiWebComponentStatus(version);
		return component ?? unavailableSessiond("health response did not include version information");
	} catch (error) {
		return unavailableSessiond(error instanceof Error ? error.message : String(error));
	}
}

function unavailableSessiond(error: string): PiWebComponentStatus {
	return {
		component: "sessiond",
		label: "Session daemon",
		stale: false,
		available: false,
		error,
	};
}

async function getLatestReleaseStatus(currentVersion: string): Promise<PiWebReleaseStatus> {
	const checkedAtMs = Date.now();
	if (skipVersionCheck()) {
		return {
			packageName: PI_WEB_PACKAGE_NAME,
			updateAvailable: false,
			checkedAt: new Date(checkedAtMs).toISOString(),
			skipped: true,
		};
	}

	if (latestReleaseCache !== undefined && checkedAtMs - latestReleaseCache.checkedAtMs < LATEST_RELEASE_CACHE_MS) {
		return releaseStatusFromCache(latestReleaseCache, currentVersion);
	}

	try {
		latestReleaseCache = { checkedAtMs, latestVersion: await fetchLatestNpmVersion(currentVersion) };
	} catch (error) {
		latestReleaseCache = { checkedAtMs, error: error instanceof Error ? error.message : String(error) };
	}
	return releaseStatusFromCache(latestReleaseCache, currentVersion);
}

function releaseStatusFromCache(
	cache: { checkedAtMs: number; latestVersion?: string; error?: string },
	currentVersion: string,
): PiWebReleaseStatus {
	return {
		packageName: PI_WEB_PACKAGE_NAME,
		...(cache.latestVersion === undefined ? {} : { latestVersion: cache.latestVersion }),
		updateAvailable:
			cache.latestVersion === undefined ? false : isNewerPackageVersion(cache.latestVersion, currentVersion),
		checkedAt: new Date(cache.checkedAtMs).toISOString(),
		...(cache.error === undefined ? {} : { error: cache.error }),
	};
}

async function fetchLatestNpmVersion(currentVersion: string): Promise<string> {
	const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PI_WEB_PACKAGE_NAME)}/latest`, {
		headers: {
			accept: "application/json",
			"user-agent": `${PI_WEB_PACKAGE_NAME}/${currentVersion}`,
		},
		signal: AbortSignal.timeout(VERSION_CHECK_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`npm registry returned HTTP ${String(response.status)}`);
	const data: unknown = await response.json();
	const version = isRecord(data) ? data["version"] : undefined;
	if (typeof version !== "string" || version === "")
		throw new Error("npm registry response did not include a version");
	return version;
}

function commandsFor(_components: PiWebStatusResponse["components"]): PiWebStatusResponse["commands"] {
	return {};
}

function buildMessages(
	components: PiWebStatusResponse["components"],
	release: PiWebReleaseStatus,
	commands: PiWebStatusResponse["commands"],
): PiWebStatusMessage[] {
	const messages: PiWebStatusMessage[] = [];
	const installedVersion = components.web.installedVersion ?? components.web.runtimeVersion;

	if (release.updateAvailable && release.latestVersion !== undefined) {
		messages.push({
			id: "update-available",
			severity: "info",
			title: "Pi update available",
			body:
				commands.update === undefined
					? `Pi ${release.latestVersion} is available${installedVersion === undefined ? "" : `; installed version is ${installedVersion}`}. Update Pi, then restart the Web mode services or processes for this installation.`
					: `Pi ${release.latestVersion} is available${installedVersion === undefined ? "" : `; installed version is ${installedVersion}`}. Run the update command to update Pi and restart Web mode services.`,
			...optionalMessageCommand(commands.update),
		});
	}

	if (components.web.stale) {
		const command = commands.restartWeb ?? commands.restart;
		messages.push({
			id: "web-stale",
			severity: "warning",
			title: "Web/UI service restart needed",
			body:
				command === undefined
					? `The Web/UI service is running ${formatVersion(components.web.runtimeVersion)}, but ${formatVersion(components.web.installedVersion)} is installed. Restart the Web/UI service or process to use the installed version.`
					: `The Web/UI service is running ${formatVersion(components.web.runtimeVersion)}, but ${formatVersion(components.web.installedVersion)} is installed. Restart the service to use the installed version.`,
			...optionalMessageCommand(command),
		});
	}

	if (!components.sessiond.available) {
		messages.push({
			id: "sessiond-unavailable",
			severity: "warning",
			title: "Session daemon version unavailable",
			body:
				commands.status === undefined
					? `Pi Web mode could not check the session daemon version${components.sessiond.error === undefined ? "." : `: ${components.sessiond.error}`}. Check the session daemon service or process that runs this installation.`
					: `Pi Web mode could not check the session daemon version${components.sessiond.error === undefined ? "." : `: ${components.sessiond.error}`}`,
			...optionalMessageCommand(commands.status),
		});
	} else if (components.sessiond.stale) {
		const command = commands.restartSessiond ?? commands.restart;
		messages.push({
			id: "sessiond-stale",
			severity: "warning",
			title: "Session daemon restart needed",
			body:
				command === undefined
					? `The session daemon is running ${formatVersion(components.sessiond.runtimeVersion)}, but ${formatVersion(components.sessiond.installedVersion)} is installed. Restart the session daemon service or process to use the installed version.`
					: `The session daemon is running ${formatVersion(components.sessiond.runtimeVersion)}, but ${formatVersion(components.sessiond.installedVersion)} is installed. Restart the daemon to use the installed version.`,
			...optionalMessageCommand(command),
		});
	}

	return messages;
}

function optionalMessageCommand(command: string | undefined): Pick<PiWebStatusMessage, "command"> | object {
	return command === undefined ? {} : { command };
}

function skipVersionCheck(): boolean {
	return ["PI_WEB_SKIP_VERSION_CHECK", "PI_WEB_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_OFFLINE"].some((key) => {
		const value = process.env[key];
		return value !== undefined && value !== "";
	});
}

function isInstalledVersionNewer(installedVersion: string | undefined, runtimeVersion: string | undefined): boolean {
	if (installedVersion === undefined || runtimeVersion === undefined) return false;
	return isNewerPackageVersion(installedVersion, runtimeVersion);
}

function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) return comparison > 0;
	return candidateVersion.trim() !== currentVersion.trim();
}

function parsePackageVersion(
	version: string,
): { major: number; minor: number; patch: number; prerelease?: string } | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/u.exec(version.trim());
	if (match === null) return undefined;
	const [, major, minor, patch, prerelease] = match;
	if (major === undefined || minor === undefined || patch === undefined) return undefined;
	return {
		major: Number.parseInt(major, 10),
		minor: Number.parseInt(minor, 10),
		patch: Number.parseInt(patch, 10),
		...(prerelease === undefined ? {} : { prerelease }),
	};
}

function formatVersion(version: string | undefined): string {
	return version ?? "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
