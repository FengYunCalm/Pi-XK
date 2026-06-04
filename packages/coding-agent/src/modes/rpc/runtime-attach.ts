import { createHash, randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import type { AgentSession } from "../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
} from "../../core/extensions/index.ts";
import { theme } from "../interactive/theme/theme.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import { handleRpcCommand, rpcResponseError } from "./rpc-command-handler.ts";
import type { RpcCommand, RpcExtensionUIRequest, RpcExtensionUIResponse } from "./rpc-types.ts";

type RpcExtensionUIRequestBody = RpcExtensionUIRequest extends infer T
	? T extends RpcExtensionUIRequest
		? Omit<T, "type" | "id">
		: never
	: never;

interface RuntimeAttachConnection {
	socket: Socket;
	pendingExtensionRequests: Map<
		string,
		{ resolve: (response: RpcExtensionUIResponse) => void; reject: (error: Error) => void }
	>;
}

export interface RuntimeAttachRecord {
	version: 1;
	pid: number;
	sessionId: string;
	cwd: string;
	socketPath: string;
	updatedAt: string;
	sessionFile?: string;
}

export interface RuntimeAttachQuery {
	sessionId?: string;
	sessionFile?: string;
}

export function runtimeAttachDir(agentDir: string): string {
	return join(agentDir, "runtime-attach");
}

export async function findRuntimeAttachRecord(
	agentDir: string,
	query: RuntimeAttachQuery,
): Promise<RuntimeAttachRecord | undefined> {
	const records = await listRuntimeAttachRecords(agentDir);
	return records.filter((record) => matchesAttachQuery(record, query))[0];
}

export async function listRuntimeAttachRecords(agentDir: string): Promise<RuntimeAttachRecord[]> {
	const dir = runtimeAttachDir(agentDir);
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return [];
	}

	const records: RuntimeAttachRecord[] = [];
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		const record = await readRuntimeAttachRecord(join(dir, file));
		if (record === undefined || !isLiveRecord(record)) continue;
		records.push(record);
	}
	return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export class RuntimeAttachServer {
	private readonly runtimeHost: AgentSessionRuntime;
	private server: Server | undefined;
	private socketPath: string | undefined;
	private recordPath: string | undefined;
	private removeRebindListener: (() => void) | undefined;
	private disposed = false;

	constructor(runtimeHost: AgentSessionRuntime) {
		this.runtimeHost = runtimeHost;
	}

	async start(): Promise<void> {
		const dir = runtimeAttachDir(this.runtimeHost.services.agentDir);
		await mkdir(dir, { recursive: true });
		this.socketPath = join(dir, `${process.pid}-${randomUUID()}.sock`);
		this.server = createServer((socket) => {
			attachRuntimeRpcConnection(this.runtimeHost, socket);
		});
		await new Promise<void>((resolve, reject) => {
			this.server?.once("error", reject);
			this.server?.listen(this.socketPath, resolve);
		});
		await this.writeRecord();
		this.removeRebindListener = this.runtimeHost.addRebindSessionListener(() => this.writeRecord());
		process.once("exit", this.removeFilesSync);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		process.off("exit", this.removeFilesSync);
		this.removeRebindListener?.();
		await new Promise<void>((resolve) => {
			this.server?.close(() => resolve());
			if (this.server === undefined) resolve();
		});
		await Promise.all([removePath(this.recordPath), removePath(this.socketPath)]);
	}

	private async writeRecord(): Promise<void> {
		if (this.socketPath === undefined) return;
		const session = this.runtimeHost.session;
		const dir = runtimeAttachDir(this.runtimeHost.services.agentDir);
		await mkdir(dir, { recursive: true });
		const nextRecordPath = join(dir, `${safeAttachKey(session.sessionId)}.json`);
		if (this.recordPath !== undefined && this.recordPath !== nextRecordPath) await removePath(this.recordPath);
		this.recordPath = nextRecordPath;
		const sessionFile = session.sessionFile;
		const record: RuntimeAttachRecord = {
			version: 1,
			pid: process.pid,
			sessionId: session.sessionId,
			cwd: session.sessionManager.getCwd(),
			socketPath: this.socketPath,
			updatedAt: new Date().toISOString(),
			...(sessionFile === undefined ? {} : { sessionFile }),
		};
		await writeFile(nextRecordPath, JSON.stringify(record, null, 2), "utf8");
	}

	private readonly removeFilesSync = (): void => {
		if (this.recordPath !== undefined) rmSync(this.recordPath, { force: true });
		if (this.socketPath !== undefined) rmSync(this.socketPath, { force: true });
	};
}

function attachRuntimeRpcConnection(runtimeHost: AgentSessionRuntime, socket: Socket): void {
	const connection: RuntimeAttachConnection = { socket, pendingExtensionRequests: new Map() };
	let session = runtimeHost.session;
	let unsubscribe = session.subscribe((event) => {
		write(socket, event);
	});
	const removeRebindListener = runtimeHost.addRebindSessionListener((nextSession) => {
		unsubscribe();
		session = nextSession;
		unsubscribe = session.subscribe((event) => write(socket, event));
		write(socket, { type: "session_rebind", sessionId: session.sessionId, sessionFile: session.sessionFile });
	});

	const detachReader = attachJsonlLineReader(socket, (line) => {
		void handleRuntimeRpcCommand(runtimeHost, () => session, connection, line);
	});
	const cleanup = () => {
		detachReader();
		removeRebindListener();
		unsubscribe();
		for (const pending of connection.pendingExtensionRequests.values()) {
			pending.reject(new Error("Runtime attach connection closed"));
		}
		connection.pendingExtensionRequests.clear();
	};
	socket.once("close", cleanup);
	socket.once("error", cleanup);
}

async function handleRuntimeRpcCommand(
	runtimeHost: AgentSessionRuntime,
	getSession: () => AgentSession,
	connection: RuntimeAttachConnection,
	line: string,
): Promise<void> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (error: unknown) {
		write(
			connection.socket,
			rpcResponseError(undefined, "parse", error instanceof Error ? error.message : String(error)),
		);
		return;
	}
	if (isExtensionResponse(parsed)) {
		handleExtensionResponse(connection, parsed);
		return;
	}
	const command = parsed as RpcCommand;
	try {
		const session = getSession();
		const result = await handleRpcCommand({
			runtimeHost,
			session,
			command,
			respond: (response) => write(connection.socket, response),
			withExtensionUI: (work) => withAttachedExtensionUI(session, connection, work),
			promptResponseMode: "immediate",
		});
		if (result !== undefined) write(connection.socket, result);
	} catch (error: unknown) {
		write(
			connection.socket,
			rpcResponseError(command.id, command.type, error instanceof Error ? error.message : String(error)),
		);
	}
}

function write(socket: Socket, value: unknown): void {
	if (!socket.destroyed) socket.write(serializeJsonLine(value));
}

function writeExtensionRequest(
	connection: RuntimeAttachConnection,
	id: string,
	request: RpcExtensionUIRequestBody,
): void {
	write(connection.socket, { type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
}

function handleExtensionResponse(connection: RuntimeAttachConnection, response: RpcExtensionUIResponse): void {
	const pending = connection.pendingExtensionRequests.get(response.id);
	if (pending === undefined) return;
	connection.pendingExtensionRequests.delete(response.id);
	pending.resolve(response);
}

function createDialogPromise<T>(
	connection: RuntimeAttachConnection,
	options: ExtensionUIDialogOptions | undefined,
	defaultValue: T,
	request: RpcExtensionUIRequestBody,
	parseResponse: (response: RpcExtensionUIResponse) => T,
): Promise<T> {
	if (options?.signal?.aborted) return Promise.resolve(defaultValue);
	const id = randomUUID();
	return new Promise((resolve) => {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timeout !== undefined) clearTimeout(timeout);
			options?.signal?.removeEventListener("abort", onAbort);
			connection.pendingExtensionRequests.delete(id);
		};
		const onAbort = () => {
			cleanup();
			resolve(defaultValue);
		};
		options?.signal?.addEventListener("abort", onAbort, { once: true });
		if (options?.timeout !== undefined) {
			timeout = setTimeout(onAbort, options.timeout);
		}
		connection.pendingExtensionRequests.set(id, {
			resolve: (response) => {
				cleanup();
				resolve(parseResponse(response));
			},
			reject: () => {
				cleanup();
				resolve(defaultValue);
			},
		});
		writeExtensionRequest(connection, id, request);
	});
}

function createAttachedExtensionUIContext(connection: RuntimeAttachConnection): ExtensionUIContext {
	return {
		select: (title, options, dialogOptions) =>
			createDialogPromise(
				connection,
				dialogOptions,
				undefined,
				{ method: "select", title, options, timeout: dialogOptions?.timeout },
				(response) => ("value" in response ? response.value : undefined),
			),
		confirm: (title, message, dialogOptions) =>
			createDialogPromise(
				connection,
				dialogOptions,
				false,
				{ method: "confirm", title, message, timeout: dialogOptions?.timeout },
				(response) => ("confirmed" in response ? response.confirmed : false),
			),
		input: (title, placeholder, dialogOptions) =>
			createDialogPromise(
				connection,
				dialogOptions,
				undefined,
				{ method: "input", title, placeholder, timeout: dialogOptions?.timeout },
				(response) => ("value" in response ? response.value : undefined),
			),
		notify(message, notifyType) {
			writeExtensionRequest(connection, randomUUID(), { method: "notify", message, notifyType });
		},
		onTerminalInput: () => () => {},
		setStatus(statusKey, statusText) {
			writeExtensionRequest(connection, randomUUID(), { method: "setStatus", statusKey, statusText });
		},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget(widgetKey, content, options?: ExtensionWidgetOptions) {
			if (content === undefined || isStringArray(content)) {
				writeExtensionRequest(connection, randomUUID(), {
					method: "setWidget",
					widgetKey,
					widgetLines: content,
					widgetPlacement: options?.placement,
				});
			}
		},
		setFooter: () => {},
		setHeader: () => {},
		setTitle(title) {
			writeExtensionRequest(connection, randomUUID(), { method: "setTitle", title });
		},
		custom: async () => undefined as never,
		pasteToEditor(text) {
			this.setEditorText(text);
		},
		setEditorText(text) {
			writeExtensionRequest(connection, randomUUID(), { method: "set_editor_text", text });
		},
		getEditorText: () => "",
		editor: (title, prefill) =>
			createDialogPromise(connection, undefined, undefined, { method: "editor", title, prefill }, (response) =>
				"value" in response ? response.value : undefined,
			),
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		get theme() {
			return theme;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "Theme switching is not supported while attached" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}

async function withAttachedExtensionUI<T>(
	session: AgentSession,
	connection: RuntimeAttachConnection,
	work: () => Promise<T>,
): Promise<T> {
	const runner = session.extensionRunner;
	const previousUIContext = runner.getUIContext();
	const previousMode = runner.getMode();
	runner.setUIContext(createAttachedExtensionUIContext(connection), "rpc");
	try {
		return await work();
	} finally {
		runner.setUIContext(previousUIContext, previousMode);
	}
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function matchesAttachQuery(record: RuntimeAttachRecord, query: RuntimeAttachQuery): boolean {
	return (
		(query.sessionId !== undefined && record.sessionId === query.sessionId) ||
		(query.sessionFile !== undefined && record.sessionFile === query.sessionFile)
	);
}

function isLiveRecord(record: RuntimeAttachRecord): boolean {
	if (!existsSync(record.socketPath)) return false;
	try {
		process.kill(record.pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function readRuntimeAttachRecord(path: string): Promise<RuntimeAttachRecord | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isRuntimeAttachRecord(parsed)) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

function isRuntimeAttachRecord(value: unknown): value is RuntimeAttachRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		typeof record.pid === "number" &&
		typeof record.sessionId === "string" &&
		typeof record.cwd === "string" &&
		typeof record.socketPath === "string" &&
		typeof record.updatedAt === "string" &&
		(record.sessionFile === undefined || typeof record.sessionFile === "string")
	);
}

function isExtensionResponse(value: unknown): value is RpcExtensionUIResponse {
	return typeof value === "object" && value !== null && "type" in value && value.type === "extension_ui_response";
}

async function removePath(path: string | undefined): Promise<void> {
	if (path !== undefined) await rm(path, { force: true });
}

function safeAttachKey(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex");
}
