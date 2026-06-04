import {
	type RuntimeAttachRecord,
	RpcClient,
	type RpcSessionSnapshot,
	type RpcSessionState,
	type SessionStats,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ClientCommand, ClientSessionStatus, ClientThinkingLevel } from "../types.ts";
import type { PiAgentSession, PiSessionManager, PiSessionRuntime } from "./piSessionService.ts";

type QueueSnapshot = { steering: string[]; followUp: string[] };
type SessionEventListener = (event: unknown) => void;
type ModelRegistryInstance = PiAgentSession["modelRegistry"];

export async function createRpcAttachedRuntime(
	record: RuntimeAttachRecord,
	modelRegistry: ModelRegistryInstance,
): Promise<PiSessionRuntime> {
	const client = new RpcClient({ socketPath: record.socketPath });
	await client.start();
	const session = await RpcAttachedAgentSession.create(client, record, modelRegistry);
	return new RpcAttachedRuntime(client, session);
}

class RpcAttachedRuntime implements PiSessionRuntime {
	readonly session: RpcAttachedAgentSession;
	private readonly client: RpcClient;
	private rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;

	constructor(client: RpcClient, session: RpcAttachedAgentSession) {
		this.client = client;
		this.session = session;
		this.session.setRebindHandler(() => {
			void this.rebindSession?.(this.session);
		});
	}

	get cwd(): string {
		return this.session.sessionManager.getCwd();
	}

	setRebindSession(rebindSession?: (session: PiAgentSession) => Promise<void>): void {
		this.rebindSession = rebindSession;
	}

	async fork(entryId: string, options?: { position?: "before" | "at" }): Promise<{ cancelled: boolean; selectedText?: string }> {
		if (options?.position === "at") {
			const result = await this.client.clone();
			await this.session.refresh();
			await this.rebindSession?.(this.session);
			return result;
		}
		const result = await this.client.fork(entryId);
		await this.session.refresh();
		await this.rebindSession?.(this.session);
		return { cancelled: result.cancelled, selectedText: result.text };
	}

	async dispose(): Promise<void> {
		await this.client.stop();
	}
}

class RpcAttachedAgentSession implements PiAgentSession {
	private readonly client: RpcClient;
	readonly modelRegistry: ModelRegistryInstance;
	private state: RpcSessionState;
	private allMessages: readonly unknown[] = [];
	private queue: QueueSnapshot = { steering: [], followUp: [] };
	private snapshot: RpcSessionSnapshot;
	private stats: SessionStats;
	private forkMessages: readonly { entryId: string; text: string }[] = [];
	private availableThinkingLevels: ClientThinkingLevel[];
	private commands: ClientCommand[] = [];
	private readonly listeners = new Set<SessionEventListener>();
	private refreshPending = false;
	private rebindHandler: (() => void) | undefined;
	readonly sessionManager: PiSessionManager;
	extensionRunner: PiAgentSession["extensionRunner"];
	promptTemplates: readonly { name: string; description?: string }[] = [];
	resourceLoader: PiAgentSession["resourceLoader"];

	private constructor(
		client: RpcClient,
		record: RuntimeAttachRecord,
		modelRegistry: ModelRegistryInstance,
		state: RpcSessionState,
		snapshot: RpcSessionSnapshot,
		stats: SessionStats,
		availableThinkingLevels: ClientThinkingLevel[],
	) {
		this.client = client;
		this.modelRegistry = modelRegistry;
		this.state = state;
		this.snapshot = snapshot;
		this.stats = stats;
		this.availableThinkingLevels = availableThinkingLevels;
		this.sessionManager = new RpcAttachedSessionManager(record, () => this.state, () => this.snapshot);
		this.extensionRunner = { getRegisteredCommands: () => extensionCommands(this.commands) };
		this.resourceLoader = { getSkills: () => ({ skills: skillCommands(this.commands) }) };
		this.client.onEvent((event) => {
			this.applyEvent(event);
			for (const listener of this.listeners) listener(event);
		});
	}

	static async create(
		client: RpcClient,
		record: RuntimeAttachRecord,
		modelRegistry: ModelRegistryInstance,
	): Promise<RpcAttachedAgentSession> {
		const [state, snapshot, stats, availableThinkingLevels] = await Promise.all([
			client.getState(),
			client.getSessionSnapshot(),
			client.getSessionStats(),
			client.getAvailableThinkingLevels(),
		]);
		const session = new RpcAttachedAgentSession(
			client,
			record,
			modelRegistry,
			state,
			snapshot,
			stats,
			availableThinkingLevels,
		);
		await session.refresh();
		return session;
	}

	get sessionId(): string {
		return this.state.sessionId;
	}

	get sessionFile(): string | undefined {
		return this.state.sessionFile;
	}

	get sessionName(): string | undefined {
		return this.state.sessionName;
	}

	get messages(): readonly unknown[] {
		return this.allMessages;
	}

	get model(): Model<Api> | undefined {
		return this.state.model as Model<Api> | undefined;
	}

	get thinkingLevel(): ClientThinkingLevel {
		return this.state.thinkingLevel;
	}

	get scopedModels(): readonly { model: Model<Api>; thinkingLevel?: ClientThinkingLevel }[] {
		return this.state.scopedModels as readonly { model: Model<Api>; thinkingLevel?: ClientThinkingLevel }[];
	}

	get isStreaming(): boolean {
		return this.state.isStreaming;
	}

	get isCompacting(): boolean {
		return this.state.isCompacting;
	}

	get isBashRunning(): boolean {
		return this.state.isBashRunning;
	}

	get pendingMessageCount(): number {
		return this.state.pendingMessageCount;
	}

	subscribe(listener: SessionEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	setRebindHandler(rebindHandler: (() => void) | undefined): void {
		this.rebindHandler = rebindHandler;
	}

	async compact(instructions?: string): Promise<{ summary: string; tokensBefore: number }> {
		const result = await this.client.compact(instructions);
		await this.refresh();
		return { summary: result.summary, tokensBefore: result.tokensBefore };
	}

	getUserMessagesForForking(): readonly { entryId: string; text: string }[] {
		return this.forkMessages;
	}

	getSessionStats(): SessionStats {
		return this.stats;
	}

	getContextUsage(): ClientSessionStatus["contextUsage"] | undefined {
		return this.state.contextUsage ?? this.stats.contextUsage;
	}

	async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
		await this.client.prompt(text, undefined, options?.streamingBehavior);
		await this.refreshState();
	}

	async executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { excludeFromContext?: boolean },
	): Promise<{ output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean; fullOutputPath?: string }> {
		const result = await this.client.bash(command, options);
		onChunk?.(result.output);
		await this.refresh();
		return result;
	}

	async abort(): Promise<void> {
		await this.client.abort();
		await this.refresh();
	}

	clearQueue(): { steering: string[]; followUp: string[] } {
		const previous = this.queue;
		this.queue = { steering: [], followUp: [] };
		void this.client
			.clearQueue()
			.then((queue) => {
				this.queue = queue;
			})
			.catch(() => {
				this.queue = previous;
				void this.refreshQueue().catch(() => undefined);
			});
		return previous;
	}

	getSteeringMessages(): readonly string[] {
		return this.queue.steering;
	}

	getFollowUpMessages(): readonly string[] {
		return this.queue.followUp;
	}

	async setModel(model: Model<Api>): Promise<void> {
		await this.client.setModel(model.provider, model.id);
		await this.refreshState();
	}

	async cycleModel(direction?: "forward" | "backward"): Promise<{ model: Model<Api> } | undefined> {
		const result = await this.client.cycleModel(direction);
		await this.refreshState();
		return result === null ? undefined : { model: result.model as Model<Api> };
	}

	getAvailableThinkingLevels(): ClientThinkingLevel[] {
		return this.availableThinkingLevels;
	}

	setThinkingLevel(level: ClientThinkingLevel): void {
		const previous = this.state.thinkingLevel;
		this.state = { ...this.state, thinkingLevel: level };
		void this.client
			.setThinkingLevel(level)
			.then(() => this.refreshState())
			.catch(() => {
				this.state = { ...this.state, thinkingLevel: previous };
				void this.refreshState().catch(() => undefined);
			});
	}

	cycleThinkingLevel(): ClientThinkingLevel | undefined {
		void this.client
			.cycleThinkingLevel()
			.then((result) => {
				if (result !== null) this.state = { ...this.state, thinkingLevel: result.level };
			})
			.catch(() => {
				void this.refreshState().catch(() => undefined);
			});
		return this.thinkingLevel;
	}

	setSessionName(name: string): void {
		const previous = this.state.sessionName;
		this.state = { ...this.state, sessionName: name };
		void this.client
			.setSessionName(name)
			.then(() => this.refreshState())
			.catch(() => {
				this.state = { ...this.state, ...(previous === undefined ? { sessionName: undefined } : { sessionName: previous }) };
				void this.refreshState().catch(() => undefined);
			});
	}

	async refresh(): Promise<void> {
		await Promise.all([
			this.refreshState(),
			this.refreshMessages(),
			this.refreshCommands(),
			this.refreshQueue(),
			this.refreshSnapshot(),
			this.refreshStats(),
			this.refreshForkMessages(),
			this.refreshAvailableThinkingLevels(),
		]);
	}

	private async refreshState(): Promise<void> {
		this.state = await this.client.getState();
	}

	private async refreshMessages(): Promise<void> {
		this.allMessages = await this.client.getMessages();
	}

	private async refreshCommands(): Promise<void> {
		this.commands = await this.client.getCommands();
		this.promptTemplates = promptCommands(this.commands);
	}

	private async refreshQueue(): Promise<void> {
		this.queue = await this.client.getQueue();
	}

	private async refreshSnapshot(): Promise<void> {
		this.snapshot = await this.client.getSessionSnapshot();
	}

	private async refreshStats(): Promise<void> {
		this.stats = await this.client.getSessionStats();
	}

	private async refreshForkMessages(): Promise<void> {
		this.forkMessages = await this.client.getForkMessages();
	}

	private async refreshAvailableThinkingLevels(): Promise<void> {
		this.availableThinkingLevels = await this.client.getAvailableThinkingLevels();
	}

	private applyEvent(event: unknown): void {
		const type = getString(event, "type");
		if (type === "session_rebind") {
			void this.refresh()
				.then(() => this.rebindHandler?.())
				.catch(() => undefined);
			return;
		}
		if (type === "agent_start") this.state = { ...this.state, isStreaming: true };
		if (type === "agent_end") this.state = { ...this.state, isStreaming: false };
		if (type === "bash_execution_start") this.state = { ...this.state, isBashRunning: true };
		if (type === "bash_execution_end") this.state = { ...this.state, isBashRunning: false };
		if (type === "queue_update") this.queue = getQueueSnapshot(event) ?? this.queue;
		if (type === "compaction_start") this.state = { ...this.state, isCompacting: true };
		if (type === "compaction_end") this.state = { ...this.state, isCompacting: false };
		if (type === "thinking_level_changed") {
			const level = getString(event, "level");
			if (isClientThinkingLevel(level)) this.state = { ...this.state, thinkingLevel: level };
		}
		this.scheduleRefresh();
	}

	private scheduleRefresh(): void {
		if (this.refreshPending) return;
		this.refreshPending = true;
		setTimeout(() => {
			this.refreshPending = false;
			void this.refresh().catch(() => undefined);
		}, 25);
	}
}

class RpcAttachedSessionManager implements PiSessionManager {
	private readonly record: RuntimeAttachRecord;
	private readonly getState: () => RpcSessionState;
	private readonly getSnapshot: () => RpcSessionSnapshot;

	constructor(record: RuntimeAttachRecord, getState: () => RpcSessionState, getSnapshot: () => RpcSessionSnapshot) {
		this.record = record;
		this.getState = getState;
		this.getSnapshot = getSnapshot;
	}

	getCwd(): string {
		return this.getSnapshot().header?.cwd ?? this.record.cwd;
	}

	getSessionId(): string {
		return this.getState().sessionId;
	}

	getSessionFile(): string | undefined {
		return this.getState().sessionFile ?? this.record.sessionFile;
	}

	getBranch(): unknown[] {
		const snapshot = this.getSnapshot();
		const byId = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
		const branch: unknown[] = [];
		let current = snapshot.leafId;
		while (current !== null) {
			const entry = byId.get(current);
			if (entry === undefined) break;
			branch.unshift(entry);
			current = entry.parentId;
		}
		return branch;
	}

	getLeafId(): string | null {
		return this.getSnapshot().leafId;
	}

	getHeader(): { parentSession?: string } | null {
		return this.getSnapshot().header;
	}
}

function extensionCommands(commands: readonly ClientCommand[]) {
	return commands
		.filter((command) => command.source === "extension")
		.map((command) => ({ invocationName: command.name, description: command.description }));
}

function promptCommands(commands: readonly ClientCommand[]) {
	return commands
		.filter((command) => command.source === "prompt")
		.map((command) => ({ name: command.name, description: command.description }));
}

function skillCommands(commands: readonly ClientCommand[]) {
	return commands
		.filter((command) => command.source === "skill")
		.map((command) => ({ name: command.name, description: command.description }));
}

function getString(value: unknown, key: string): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" ? field : undefined;
}

function getQueueSnapshot(value: unknown): QueueSnapshot | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	return stringArray(record["steering"]) && stringArray(record["followUp"])
		? { steering: record["steering"], followUp: record["followUp"] }
		: undefined;
}

function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isClientThinkingLevel(value: string | undefined): value is ClientThinkingLevel {
	return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}
