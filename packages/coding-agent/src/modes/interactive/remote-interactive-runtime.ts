import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model, Transport } from "@earendil-works/pi-ai";
import type { KeyId } from "@earendil-works/pi-tui";
import type { AgentSessionEvent, ModelCycleResult, SessionStats } from "../../core/agent-session.ts";
import type { AgentSessionServices } from "../../core/agent-session-services.ts";
import type { ResolvedCommand } from "../../core/extensions/index.ts";
import type { KeybindingsConfig } from "../../core/keybindings.ts";
import type { ModelRegistry } from "../../core/model-registry.ts";
import {
	CURRENT_SESSION_VERSION,
	type SessionContext,
	type SessionEntry,
	type SessionHeader,
	type SessionTreeNode,
} from "../../core/session-manager.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import { resolvePath } from "../../utils/paths.ts";
import type { RpcClient } from "../rpc/rpc-client.ts";
import type {
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcSessionSnapshot,
	RpcSessionState,
	RpcSlashCommand,
} from "../rpc/rpc-types.ts";
import type {
	InteractiveAgent,
	InteractiveExtensionRunner,
	InteractiveResourceLoader,
	InteractiveRuntimeHost,
	InteractiveSession,
	InteractiveSessionManager,
	InteractiveSessionState,
} from "./interactive-runtime.ts";

interface RemoteInteractiveRuntimeOptions {
	client: RpcClient;
	services: AgentSessionServices;
	cwd: string;
	sessionDir: string;
	sessionFile: string | undefined;
}

export class RemoteInteractiveRuntimeHost implements InteractiveRuntimeHost {
	readonly services: AgentSessionServices;
	readonly session: RemoteInteractiveSession;
	private rebindSession: ((session: InteractiveSession) => Promise<void>) | undefined;

	private constructor(
		options: RemoteInteractiveRuntimeOptions,
		state: RpcSessionState,
		messages: AgentMessage[],
		snapshot: RpcSessionSnapshot,
		commands: RpcSlashCommand[],
		availableThinkingLevels: ThinkingLevel[],
	) {
		this.services = options.services;
		this.session = new RemoteInteractiveSession(
			options,
			state,
			messages,
			snapshot,
			commands,
			availableThinkingLevels,
		);
	}

	static async create(options: RemoteInteractiveRuntimeOptions): Promise<RemoteInteractiveRuntimeHost> {
		const [state, messages, snapshot, commands, availableThinkingLevels] = await Promise.all([
			options.client.getState(),
			options.client.getMessages(),
			options.client.getSessionSnapshot(),
			options.client.getCommands(),
			options.client.getAvailableThinkingLevels(),
		]);
		const host = new RemoteInteractiveRuntimeHost(
			options,
			state,
			messages,
			snapshot,
			commands,
			availableThinkingLevels,
		);
		options.client.onEvent((event) => {
			host.session.applyEvent(event as AgentSessionEvent);
		});
		options.client.onExtensionUIRequest((request) => {
			void host.session.handleExtensionUIRequest(request);
		});
		return host;
	}

	setBeforeSessionInvalidate(): void {}

	setRebindSession(rebindSession?: (session: InteractiveSession) => Promise<void>): void {
		this.rebindSession = rebindSession;
		void this.rebindSession;
	}

	setExtensionUIRequestHandler(
		handler?: (request: RpcExtensionUIRequest) => Promise<RpcExtensionUIResponse | undefined>,
	): void {
		this.session.setExtensionUIRequestHandler(handler);
	}

	async newSession(): Promise<{ cancelled: boolean }> {
		const result = await this.session.client.newSession();
		await this.session.refresh();
		await this.rebindSession?.(this.session);
		return result;
	}

	async fork(
		entryId: string,
		options?: { position?: "before" | "at" },
	): Promise<{ cancelled: boolean; selectedText?: string }> {
		if (options?.position === "at") {
			const result = await this.session.client.clone();
			await this.session.refresh();
			await this.rebindSession?.(this.session);
			return result;
		}

		const result = await this.session.client.fork(entryId);
		await this.session.refresh();
		await this.rebindSession?.(this.session);
		return { cancelled: result.cancelled, selectedText: result.text };
	}

	async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		const result = await this.session.client.switchSession(sessionPath);
		await this.session.refresh();
		await this.rebindSession?.(this.session);
		return result;
	}

	async importFromJsonl(): Promise<{ cancelled: boolean }> {
		throw new Error("Import is not supported while attached to a remote runtime");
	}

	async dispose(): Promise<void> {
		await this.session.client.stop();
	}
}

export class RemoteInteractiveSession implements InteractiveSession {
	readonly client: RpcClient;
	readonly settingsManager: SettingsManager;
	readonly modelRegistry: ModelRegistry;
	readonly resourceLoader: InteractiveResourceLoader;
	readonly sessionManager: InteractiveSessionManager;
	readonly extensionRunner: InteractiveExtensionRunner;
	readonly agent: InteractiveAgent;
	private currentState: RpcSessionState;
	private currentMessages: AgentMessage[];
	private currentSnapshot: RpcSessionSnapshot;
	private currentCommands: RpcSlashCommand[];
	private currentAvailableThinkingLevels: ThinkingLevel[];
	private steeringMessages: string[] = [];
	private followUpMessages: string[] = [];
	private listeners = new Set<(event: AgentSessionEvent) => void | Promise<void>>();
	private extensionUIRequestHandler:
		| ((request: RpcExtensionUIRequest) => Promise<RpcExtensionUIResponse | undefined>)
		| undefined;

	constructor(
		options: RemoteInteractiveRuntimeOptions,
		state: RpcSessionState,
		messages: AgentMessage[],
		snapshot: RpcSessionSnapshot,
		commands: RpcSlashCommand[],
		availableThinkingLevels: ThinkingLevel[],
	) {
		this.client = options.client;
		this.settingsManager = options.services.settingsManager;
		this.modelRegistry = options.services.modelRegistry;
		this.resourceLoader = options.services.resourceLoader;
		this.currentState = state;
		this.currentMessages = messages;
		this.currentSnapshot = snapshot;
		this.currentCommands = commands;
		this.currentAvailableThinkingLevels = availableThinkingLevels;
		this.sessionManager = new RemoteInteractiveSessionManager(
			options,
			this.client,
			() => this.currentState,
			() => this.currentSnapshot,
			() => this.refresh(),
		);
		this.extensionRunner = new RemoteInteractiveExtensionRunner(this.client, () => this.currentCommands);
		const session = this;
		this.agent = {
			abort: () => {
				void this.abort();
			},
			get signal() {
				return undefined;
			},
			get transport() {
				return session.currentState.transport;
			},
			set transport(transport: Transport) {
				void session.client.setTransport(transport).then(() => session.refresh());
			},
			waitForIdle: () => this.waitForIdle(),
		};
	}

	get state(): InteractiveSessionState {
		return {
			messages: this.currentMessages,
			model: this.currentState.model,
			thinkingLevel: this.currentState.thinkingLevel,
		};
	}

	get scopedModels(): readonly { model: Model<any>; thinkingLevel?: ThinkingLevel }[] {
		return this.currentState.scopedModels;
	}

	get model(): Model<any> | undefined {
		return this.currentState.model;
	}

	get thinkingLevel(): ThinkingLevel {
		return this.currentState.thinkingLevel;
	}

	get messages(): AgentMessage[] {
		return this.currentMessages;
	}

	get promptTemplates() {
		return this.resourceLoader.getPrompts().prompts;
	}

	get isStreaming(): boolean {
		return this.currentState.isStreaming;
	}

	get isCompacting(): boolean {
		return this.currentState.isCompacting;
	}

	get isBashRunning(): boolean {
		return this.currentState.isBashRunning;
	}

	get pendingMessageCount(): number {
		return this.currentState.pendingMessageCount;
	}

	get autoCompactionEnabled(): boolean {
		return this.currentState.autoCompactionEnabled;
	}

	get steeringMode(): "all" | "one-at-a-time" {
		return this.currentState.steeringMode;
	}

	get followUpMode(): "all" | "one-at-a-time" {
		return this.currentState.followUpMode;
	}

	get systemPrompt(): string {
		return this.currentState.systemPrompt;
	}

	get retryAttempt(): number {
		return this.currentState.retryAttempt;
	}

	subscribe(listener: (event: AgentSessionEvent) => void | Promise<void>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	setExtensionUIRequestHandler(
		handler?: (request: RpcExtensionUIRequest) => Promise<RpcExtensionUIResponse | undefined>,
	): void {
		this.extensionUIRequestHandler = handler;
	}

	async bindExtensions(): Promise<void> {}

	async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
		await this.client.prompt(text, undefined, options?.streamingBehavior);
		await this.refresh();
	}

	async steer(text: string): Promise<void> {
		await this.client.steer(text);
		await this.refresh();
	}

	async followUp(text: string): Promise<void> {
		await this.client.followUp(text);
		await this.refresh();
	}

	async abort(): Promise<void> {
		await this.client.abort();
		await this.refresh();
	}

	abortBash(): void {
		void this.client.abortBash();
	}

	abortBranchSummary(): void {
		void this.client.abortBranchSummary().then(() => this.refresh());
	}
	abortCompaction(): void {
		void this.client.abortCompaction().then(() => this.refresh());
	}
	abortRetry(): void {
		void this.client.abortRetry();
	}

	async compact(customInstructions?: string) {
		const result = await this.client.compact(customInstructions);
		await this.refresh();
		return result;
	}

	async cycleModel(direction?: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const result = await this.client.cycleModel(direction);
		await this.refresh();
		return result ?? undefined;
	}

	async setModel(model: Model<any>): Promise<void> {
		await this.client.setModel(model.provider, model.id);
		await this.refresh();
	}

	cycleThinkingLevel(): ThinkingLevel | undefined {
		void this.client.cycleThinkingLevel().then(() => this.refresh());
		return this.thinkingLevel;
	}

	setThinkingLevel(level: ThinkingLevel): void {
		void this.client.setThinkingLevel(level).then(() => this.refresh());
	}

	getAvailableThinkingLevels(): ThinkingLevel[] {
		return this.currentAvailableThinkingLevels;
	}

	getSteeringMessages(): readonly string[] {
		return this.steeringMessages;
	}

	getFollowUpMessages(): readonly string[] {
		return this.followUpMessages;
	}

	clearQueue(): { steering: string[]; followUp: string[] } {
		const previous = { steering: this.steeringMessages, followUp: this.followUpMessages };
		this.steeringMessages = [];
		this.followUpMessages = [];
		void this.client.clearQueue().then((queue) => {
			this.steeringMessages = queue.steering;
			this.followUpMessages = queue.followUp;
		});
		return previous;
	}

	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		void this.client.setSteeringMode(mode).then(() => this.refresh());
	}

	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		void this.client.setFollowUpMode(mode).then(() => this.refresh());
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		void this.client.setAutoCompaction(enabled).then(() => this.refresh());
	}

	setSessionName(name: string): void {
		void this.client.setSessionName(name).then(() => this.refresh());
	}

	setScopedModels(scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): void {
		void this.client
			.setScopedModels(
				scopedModels.map((scopedModel) => ({
					provider: scopedModel.model.provider,
					modelId: scopedModel.model.id,
					thinkingLevel: scopedModel.thinkingLevel,
				})),
			)
			.then(() => this.refresh());
	}

	async executeBash(command: string, _onOutput?: (chunk: string) => void, options?: { excludeFromContext?: boolean }) {
		return this.client.bash(command, { excludeFromContext: options?.excludeFromContext });
	}

	recordBashResult(): void {}
	reload(): Promise<void> {
		return this.refresh();
	}

	async navigateTree(
		targetId: string,
		options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean }> {
		const result = await this.client.navigateTree(targetId, options);
		await this.refresh();
		return result;
	}

	getToolDefinition(): undefined {
		return undefined;
	}

	getContextUsage() {
		return this.currentState.contextUsage;
	}

	async getSessionStats(): Promise<SessionStats> {
		return this.client.getSessionStats();
	}

	async getUserMessagesForForking(): Promise<Array<{ entryId: string; text: string }>> {
		return this.client.getForkMessages();
	}

	async getLastAssistantText(): Promise<string | undefined> {
		return (await this.client.getLastAssistantText()) ?? undefined;
	}

	exportToHtml(outputPath?: string): Promise<string> {
		return this.client.exportHtml(outputPath).then((result) => result.path);
	}

	exportToJsonl(outputPath?: string): string {
		const filePath = resolvePath(
			outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
			process.cwd(),
		);
		const dir = dirname(filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: this.sessionManager.getSessionId(),
			timestamp: new Date().toISOString(),
			cwd: this.sessionManager.getCwd(),
		};

		const branchEntries = this.sessionManager.getBranch();
		const lines = [JSON.stringify(header)];
		let previousId: string | null = null;
		for (const entry of branchEntries) {
			lines.push(JSON.stringify({ ...entry, parentId: previousId }));
			previousId = entry.id;
		}

		writeFileSync(filePath, `${lines.join("\n")}\n`);
		return filePath;
	}

	async refresh(): Promise<void> {
		const [state, messages, queue, snapshot, commands, availableThinkingLevels] = await Promise.all([
			this.client.getState(),
			this.client.getMessages(),
			this.client.getQueue(),
			this.client.getSessionSnapshot(),
			this.client.getCommands(),
			this.client.getAvailableThinkingLevels(),
		]);
		this.currentState = state;
		this.currentMessages = messages;
		this.steeringMessages = queue.steering;
		this.followUpMessages = queue.followUp;
		this.currentSnapshot = snapshot;
		this.currentCommands = commands;
		this.currentAvailableThinkingLevels = availableThinkingLevels;
	}

	applyEvent(event: AgentSessionEvent): void {
		for (const listener of this.listeners) void listener(event);
		void this.refresh();
	}

	async handleExtensionUIRequest(request: RpcExtensionUIRequest): Promise<void> {
		try {
			const response = await this.extensionUIRequestHandler?.(request);
			if (response !== undefined) {
				await this.client.respondExtensionUI(response);
				return;
			}
		} catch {
			// Respond with cancellation below for request/response dialog methods.
		}
		if (extensionUIRequestNeedsResponse(request)) {
			await this.client.respondExtensionUI({ type: "extension_ui_response", id: request.id, cancelled: true });
		}
	}

	private waitForIdle(): Promise<void> {
		return this.client.waitForIdle();
	}
}

function extensionUIRequestNeedsResponse(request: RpcExtensionUIRequest): boolean {
	return (
		request.method === "select" ||
		request.method === "confirm" ||
		request.method === "input" ||
		request.method === "editor"
	);
}

class RemoteInteractiveSessionManager implements InteractiveSessionManager {
	private readonly options: RemoteInteractiveRuntimeOptions;
	private readonly client: RpcClient;
	private readonly getState: () => RpcSessionState;
	private readonly getSnapshot: () => RpcSessionSnapshot;
	private readonly refresh: () => Promise<void>;

	constructor(
		options: RemoteInteractiveRuntimeOptions,
		client: RpcClient,
		getState: () => RpcSessionState,
		getSnapshot: () => RpcSessionSnapshot,
		refresh: () => Promise<void>,
	) {
		this.options = options;
		this.client = client;
		this.getState = getState;
		this.getSnapshot = getSnapshot;
		this.refresh = refresh;
	}

	getCwd(): string {
		return this.options.cwd;
	}

	getSessionDir(): string {
		return this.options.sessionDir;
	}

	usesDefaultSessionDir(): boolean {
		return true;
	}

	getSessionId(): string {
		return this.getState().sessionId;
	}

	getSessionFile(): string | undefined {
		return this.getState().sessionFile ?? this.options.sessionFile;
	}

	getSessionName(): string | undefined {
		return this.getState().sessionName;
	}

	getLeafId(): string | null {
		return this.getSnapshot().leafId;
	}

	getLeafEntry(): SessionEntry | undefined {
		const leafId = this.getLeafId();
		return leafId ? this.getEntry(leafId) : undefined;
	}

	getEntry(id: string): SessionEntry | undefined {
		return this.getSnapshot().entries.find((entry) => entry.id === id);
	}

	getLabel(id: string): string | undefined {
		let label: string | undefined;
		for (const entry of this.getSnapshot().entries) {
			if (entry.type === "label" && entry.targetId === id) {
				label = entry.label;
			}
		}
		return label;
	}

	getBranch(fromId?: string): SessionEntry[] {
		const entries = this.getSnapshot().entries;
		const byId = new Map(entries.map((entry) => [entry.id, entry]));
		const branch: SessionEntry[] = [];
		let current = fromId ?? this.getLeafId();
		while (current) {
			const entry = byId.get(current);
			if (!entry) break;
			branch.unshift(entry);
			current = entry.parentId;
		}
		return branch;
	}

	getHeader(): SessionHeader | null {
		return this.getSnapshot().header;
	}

	getEntries(): SessionEntry[] {
		return this.getSnapshot().entries;
	}

	getTree(): SessionTreeNode[] {
		return this.getSnapshot().tree;
	}

	async appendLabelChange(targetId: string, label: string | undefined): Promise<string> {
		const result = await this.client.setLabel(targetId, label);
		await this.refresh();
		return result.id;
	}

	buildSessionContext(): SessionContext {
		return this.getSnapshot().context;
	}
}

class RemoteInteractiveExtensionRunner implements InteractiveExtensionRunner {
	private readonly client: RpcClient;
	private readonly getCommands: () => RpcSlashCommand[];

	constructor(client: RpcClient, getCommands: () => RpcSlashCommand[]) {
		this.client = client;
		this.getCommands = getCommands;
	}

	async emitUserBash(): Promise<undefined> {
		return undefined;
	}
	getCommand(name: string): ResolvedCommand | undefined {
		const command = this.getCommands().find((entry) => entry.source === "extension" && entry.name === name);
		return command ? this.toResolvedCommand(command) : undefined;
	}
	getRegisteredCommands(): ResolvedCommand[] {
		return this.getCommands()
			.filter((entry) => entry.source === "extension")
			.map((entry) => this.toResolvedCommand(entry));
	}
	getCommandDiagnostics(): [] {
		return [];
	}
	getMessageRenderer(): undefined {
		return undefined;
	}
	getShortcutDiagnostics(): [] {
		return [];
	}
	async getShortcuts(
		..._args: Parameters<InteractiveExtensionRunner["getShortcuts"]>
	): Promise<Awaited<ReturnType<InteractiveExtensionRunner["getShortcuts"]>>> {
		const keybindings = _args[0] as KeybindingsConfig;
		const shortcuts: Awaited<ReturnType<InteractiveExtensionRunner["getShortcuts"]>> = new Map();
		for (const shortcut of await this.client.getShortcuts(keybindings)) {
			const shortcutKey = shortcut.shortcut as KeyId;
			shortcuts.set(shortcutKey, {
				shortcut: shortcutKey,
				description: shortcut.description,
				extensionPath: shortcut.extensionPath,
				handler: () => this.client.runShortcut(shortcut.shortcut, keybindings),
			});
		}
		return shortcuts;
	}

	private toResolvedCommand(command: RpcSlashCommand): ResolvedCommand {
		return {
			name: command.name,
			invocationName: command.name,
			description: command.description,
			sourceInfo: command.sourceInfo,
			handler: async (args) => {
				await this.client.prompt(args.trim() ? `/${command.name} ${args}` : `/${command.name}`);
			},
		};
	}
}
