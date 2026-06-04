import { describe, expect, it, vi } from "vitest";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createRpcAttachedRuntime } from "./rpcAttachedRuntime.ts";

type FakeThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type FakeQueue = { steering: string[]; followUp: string[] };
type FakeListener = (event: unknown) => void;

interface FakeState {
	transport: { name: string };
	scopedModels: [];
	thinkingLevel: FakeThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	isBashRunning: boolean;
	steeringMode: "all";
	followUpMode: "all";
	sessionFile: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
	retryAttempt: number;
	systemPrompt: string;
}

interface FakeRpcClientInstance {
	failClearQueue: boolean;
	failGetState: boolean;
	failSetThinkingLevel: boolean;
	emit(event: unknown): void;
}

const rpcMock = vi.hoisted(() => {
	class FakeRpcClient {
		static readonly instances: FakeRpcClient[] = [];
		readonly listeners: FakeListener[] = [];
		failClearQueue = false;
		failGetState = false;
		failSetThinkingLevel = false;
		state: FakeState = createFakeState();
		queue: FakeQueue = { steering: ["old steer"], followUp: ["old follow-up"] };

		constructor() {
			FakeRpcClient.instances.push(this);
		}

		start(): Promise<void> {
			return Promise.resolve();
		}

		stop(): Promise<void> {
			return Promise.resolve();
		}

		onEvent(listener: FakeListener): void {
			this.listeners.push(listener);
		}

		emit(event: unknown): void {
			for (const listener of this.listeners) listener(event);
		}

		getState(): Promise<FakeState> {
			return this.failGetState ? Promise.reject(new Error("state unavailable")) : Promise.resolve(this.state);
		}

		getSessionSnapshot(): Promise<unknown> {
			return Promise.resolve({ header: { cwd: "/workspace" }, entries: [], tree: [], leafId: null, context: {} });
		}

		getSessionStats(): Promise<unknown> {
			return Promise.resolve({
				sessionId: this.state.sessionId,
				totalMessages: 0,
				userMessages: 0,
				assistantMessages: 0,
				toolCalls: 0,
				tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				cost: 0,
			});
		}

		getAvailableThinkingLevels(): Promise<FakeThinkingLevel[]> {
			return Promise.resolve(["off", "high"]);
		}

		getMessages(): Promise<unknown[]> {
			return Promise.resolve([]);
		}

		getCommands(): Promise<unknown[]> {
			return Promise.resolve([]);
		}

		getQueue(): Promise<FakeQueue> {
			return Promise.resolve(this.queue);
		}

		getForkMessages(): Promise<unknown[]> {
			return Promise.resolve([]);
		}

		clearQueue(): Promise<FakeQueue> {
			if (this.failClearQueue) return Promise.reject(new Error("queue unavailable"));
			const previous = this.queue;
			this.queue = { steering: [], followUp: [] };
			return Promise.resolve(previous);
		}

		setThinkingLevel(level: FakeThinkingLevel): Promise<void> {
			if (this.failSetThinkingLevel) return Promise.reject(new Error("thinking unavailable"));
			this.state = { ...this.state, thinkingLevel: level };
			return Promise.resolve();
		}

		cycleThinkingLevel(): Promise<{ level: FakeThinkingLevel } | null> {
			return Promise.resolve(null);
		}

		setSessionName(name: string): Promise<void> {
			this.state = { ...this.state, sessionName: name };
			return Promise.resolve();
		}

		prompt(): Promise<void> {
			return Promise.resolve();
		}

		compact(): Promise<{ summary: string; tokensBefore: number }> {
			return Promise.resolve({ summary: "", tokensBefore: 0 });
		}

		bash(): Promise<{ output: string; exitCode: number; cancelled: boolean; truncated: boolean }> {
			return Promise.resolve({ output: "", exitCode: 0, cancelled: false, truncated: false });
		}

		abort(): Promise<void> {
			return Promise.resolve();
		}

		setModel(): Promise<void> {
			return Promise.resolve();
		}

		cycleModel(): Promise<null> {
			return Promise.resolve(null);
		}
	}

	function createFakeState(): FakeState {
		return {
			transport: { name: "fake" },
			scopedModels: [],
			thinkingLevel: "off",
			isStreaming: false,
			isCompacting: false,
			isBashRunning: false,
			steeringMode: "all",
			followUpMode: "all",
			sessionFile: "/tmp/session.jsonl",
			sessionId: "rpc-session",
			autoCompactionEnabled: true,
			messageCount: 0,
			pendingMessageCount: 0,
			retryAttempt: 0,
			systemPrompt: "",
		};
	}

	return { FakeRpcClient };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
	...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
	RpcClient: rpcMock.FakeRpcClient,
}));

describe("createRpcAttachedRuntime", () => {
	it("rolls back optimistic thinking-level changes when RPC fails", async () => {
		const runtime = await createRuntime();
		const client = latestClient();
		client.failSetThinkingLevel = true;

		runtime.session.setThinkingLevel("high");

		await vi.waitFor(() => expect(runtime.session.thinkingLevel).toBe("off"));
		await runtime.dispose();
	});

	it("rolls back optimistic queue clearing when RPC fails", async () => {
		const runtime = await createRuntime();
		const client = latestClient();
		client.failClearQueue = true;

		expect(runtime.session.getSteeringMessages()).toEqual(["old steer"]);
		expect(runtime.session.clearQueue()).toEqual({ steering: ["old steer"], followUp: ["old follow-up"] });

		await vi.waitFor(() => expect(runtime.session.getSteeringMessages()).toEqual(["old steer"]));
		await runtime.dispose();
	});

	it("swallows background refresh failures after RPC events", async () => {
		vi.useFakeTimers();
		try {
			const runtime = await createRuntime();
			const client = latestClient();
			client.failGetState = true;

			client.emit({ type: "agent_start" });
			await vi.advanceTimersByTimeAsync(25);

			expect(runtime.session.isStreaming).toBe(true);
			await runtime.dispose();
		} finally {
			vi.useRealTimers();
		}
	});
});

async function createRuntime() {
	return createRpcAttachedRuntime(
		{
			version: 1,
			pid: process.pid,
			sessionId: "rpc-session",
			cwd: "/workspace",
			socketPath: "/tmp/rpc.sock",
			updatedAt: "2026-01-01T00:00:00.000Z",
			sessionFile: "/tmp/session.jsonl",
		},
		ModelRegistry.create(AuthStorage.inMemory()),
	);
}

function latestClient(): FakeRpcClientInstance {
	const client = rpcMock.FakeRpcClient.instances.at(-1);
	if (client === undefined) throw new Error("Fake RPC client was not created");
	return client;
}
