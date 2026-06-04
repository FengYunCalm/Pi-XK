import type { PiAgentSession } from "./piSessionService.ts";

export type QueuedPromptKind = "steer" | "followUp";

export interface QueuedPrompt {
	kind: QueuedPromptKind;
	text: string;
}

export interface CompactionPromptQueueOptions {
	getSession: (sessionId: string) => PiAgentSession | undefined;
	publishStatus: (session: PiAgentSession) => void;
	submitPrompt: (session: PiAgentSession, text: string, behavior: QueuedPromptKind | undefined) => Promise<void>;
}

export class CompactionPromptQueue {
	private readonly queues = new Map<string, QueuedPrompt[]>();
	private readonly drainTimers = new Map<string, NodeJS.Timeout>();
	private readonly getSession: (sessionId: string) => PiAgentSession | undefined;
	private readonly publishStatus: (session: PiAgentSession) => void;
	private readonly submitPrompt: (
		session: PiAgentSession,
		text: string,
		behavior: QueuedPromptKind | undefined,
	) => Promise<void>;

	constructor(options: CompactionPromptQueueOptions) {
		this.getSession = options.getSession;
		this.publishStatus = options.publishStatus;
		this.submitPrompt = options.submitPrompt;
	}

	enqueue(sessionId: string, prompt: QueuedPrompt): void {
		const queue = this.queues.get(sessionId) ?? [];
		queue.push(prompt);
		this.queues.set(sessionId, queue);
	}

	queuedMessages(sessionId: string): readonly QueuedPrompt[] {
		return this.queues.get(sessionId) ?? [];
	}

	clear(sessionId: string): void {
		this.queues.delete(sessionId);
		const timer = this.drainTimers.get(sessionId);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.drainTimers.delete(sessionId);
		}
	}

	clearAll(): void {
		this.queues.clear();
		for (const timer of this.drainTimers.values()) clearTimeout(timer);
		this.drainTimers.clear();
	}

	scheduleDrain(sessionId: string, delayMs = 0): void {
		if (!this.queues.has(sessionId) || this.drainTimers.has(sessionId)) return;
		const timer = setTimeout(() => {
			this.drainTimers.delete(sessionId);
			this.drain(sessionId);
		}, delayMs);
		this.drainTimers.set(sessionId, timer);
	}

	private drain(sessionId: string): void {
		const session = this.getSession(sessionId);
		if (session === undefined) return;
		if (session.isCompacting) {
			this.scheduleDrain(sessionId, 100);
			return;
		}

		if (session.isStreaming) {
			const queued = this.take(sessionId);
			if (queued.length === 0) return;
			this.publishStatus(session);
			for (const prompt of queued) void this.submitPrompt(session, prompt.text, prompt.kind);
			return;
		}

		const prompt = this.shift(sessionId);
		if (prompt === undefined) return;
		this.publishStatus(session);
		const submitted = this.submitPrompt(session, prompt.text, undefined);
		void submitted.finally(() => {
			this.scheduleDrain(sessionId);
		});
	}

	private take(sessionId: string): QueuedPrompt[] {
		const queued = this.queues.get(sessionId) ?? [];
		this.queues.delete(sessionId);
		return queued;
	}

	private shift(sessionId: string): QueuedPrompt | undefined {
		const queue = this.queues.get(sessionId);
		const prompt = queue?.shift();
		if (queue === undefined || queue.length === 0) this.queues.delete(sessionId);
		return prompt;
	}
}
