import type { WorkspaceActivityService } from "../activity/workspaceActivityService.ts";
import type { SessionEventHub } from "../realtime/sessionEventHub.ts";
import type { ClientSessionModel, ClientSessionStatus } from "../types.ts";
import type { PiAgentSession } from "./piSessionService.ts";

type QueuedMessage = { kind: "steer" | "followUp"; text: string };
type ActivityPhase = "active" | "idle" | "error";
type ActivityRecord = { phase: ActivityPhase; label: string; detail?: string; at: string };

export interface SessionStatePublisherOptions {
	events: SessionEventHub;
	workspaceActivity?: Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession">;
	extraQueuedMessages?: (sessionId: string) => readonly QueuedMessage[];
}

export class SessionStatePublisher {
	private readonly activities = new Map<string, ActivityRecord>();
	private readonly events: SessionEventHub;
	private readonly workspaceActivity:
		| Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession">
		| undefined;
	private readonly extraQueuedMessages: (sessionId: string) => readonly QueuedMessage[];

	constructor(options: SessionStatePublisherOptions) {
		this.events = options.events;
		this.workspaceActivity = options.workspaceActivity;
		this.extraQueuedMessages = options.extraQueuedMessages ?? (() => []);
	}

	clear(): void {
		this.activities.clear();
	}

	removeSession(sessionId: string, cwd?: string): void {
		this.activities.delete(sessionId);
		this.workspaceActivity?.removeSession(sessionId, cwd);
	}

	publishSessionName(session: PiAgentSession): void {
		const event =
			session.sessionName === undefined
				? ({ type: "session.name", sessionId: session.sessionId } as const)
				: ({ type: "session.name", sessionId: session.sessionId, name: session.sessionName } as const);
		this.events.publish(session.sessionId, event);
		this.events.publishGlobal(event);
	}

	publishHeartbeats(sessions: Iterable<PiAgentSession>): void {
		for (const session of sessions) {
			const activity = this.activities.get(session.sessionId);
			if (!this.hasActiveWork(session)) {
				if (activity?.phase === "active") this.publishStatus(session);
				continue;
			}
			this.publishStatus(session);
			if (activity?.phase === "active") this.publishActivity(session, activity.label, "active", activity.detail);
			else this.publishActivity(session, this.activityLabelFromStatus(session), "active");
		}
	}

	publishActivityForEvent(session: PiAgentSession, event: unknown): void {
		const eventType = getString(event, "type");
		if (eventType === undefined) return;
		if (eventType === "agent_start") {
			this.publishActivity(session, "agent running", "active");
			return;
		}
		if (eventType === "agent_end") {
			this.publishActivity(session, "idle", "idle");
			setTimeout(() => {
				this.publishActivity(session, "idle", "idle");
				this.publishStatus(session);
			}, 250);
			return;
		}
		if (eventType === "turn_end") {
			this.publishActivity(session, "turn complete", "idle");
			return;
		}
		if (eventType === "message_start") {
			this.publishActivity(session, "message started", "active");
			return;
		}
		if (eventType === "message_end") {
			this.publishActivity(session, "message complete", "idle");
			return;
		}
		if (eventType === "message_update") {
			this.publishActivity(session, "receiving response", "active");
			return;
		}
		if (eventType === "tool_execution_start") {
			this.publishActivity(session, "running tool", "active", getString(event, "toolName"));
			return;
		}
		if (eventType === "tool_execution_end") {
			const isError = getBoolean(event, "isError") === true;
			this.publishActivity(
				session,
				isError ? "tool failed" : "tool complete",
				isError ? "error" : "idle",
				getString(event, "toolName"),
			);
			return;
		}
		if (eventType === "bash_execution_start") {
			this.publishActivity(session, "running bash", "active");
			return;
		}
		if (eventType === "bash_execution_end") {
			this.publishActivity(session, "bash complete", "idle");
			return;
		}
		if (this.hasActiveWork(session)) this.publishActivity(session, eventType.replaceAll("_", " "), "active");
	}

	publishActivity(session: PiAgentSession, label: string, phase: ActivityPhase, detail?: string): void {
		const at = new Date().toISOString();
		const stored = detail === undefined ? { phase, label, at } : { phase, label, detail, at };
		this.activities.set(session.sessionId, stored);
		const activity =
			detail === undefined
				? { sessionId: session.sessionId, phase, label, at }
				: { sessionId: session.sessionId, phase, label, detail, at };
		this.workspaceActivity?.applySessionActivity(session.sessionManager.getCwd(), activity);
		this.events.publish(session.sessionId, { type: "activity.update", activity });
		this.events.publishGlobal({ type: "activity.update", activity });
	}

	publishStatus(session: PiAgentSession): void {
		const status = this.statusFromSession(session);
		this.clearStaleActiveActivity(session);
		this.workspaceActivity?.applySessionStatus(session.sessionManager.getCwd(), status);
		this.events.publish(session.sessionId, { type: "status.update", status });
		this.events.publishGlobal({ type: "status.update", status });
	}

	statusFromSession(session: PiAgentSession): ClientSessionStatus {
		const stats = session.getSessionStats();
		const model = session.model === undefined ? undefined : modelToClientModel(session.model);
		const contextUsage = session.getContextUsage();
		return {
			sessionId: session.sessionId,
			...(model === undefined ? {} : { model }),
			thinkingLevel: session.thinkingLevel,
			isStreaming: session.isStreaming,
			isCompacting: session.isCompacting,
			isBashRunning: session.isBashRunning,
			pendingMessageCount: this.pendingMessageCount(session),
			queuedMessages: this.queuedMessages(session),
			messageCount: session.messages.length,
			tokens: stats.tokens,
			cost: stats.cost,
			...(contextUsage === undefined ? {} : { contextUsage }),
		};
	}

	queuedMessages(session: PiAgentSession): QueuedMessage[] {
		return [
			...session.getSteeringMessages().map((text) => ({ kind: "steer" as const, text })),
			...session.getFollowUpMessages().map((text) => ({ kind: "followUp" as const, text })),
			...this.extraQueuedMessages(session.sessionId),
		];
	}

	hasActiveWork(session: PiAgentSession): boolean {
		return (
			session.isStreaming ||
			session.isCompacting ||
			session.isBashRunning ||
			this.pendingMessageCount(session) > 0
		);
	}

	private pendingMessageCount(session: PiAgentSession): number {
		return session.pendingMessageCount + this.extraQueuedMessages(session.sessionId).length;
	}

	private activityLabelFromStatus(session: PiAgentSession): string {
		if (session.isCompacting) return "compacting";
		if (session.isBashRunning) return "running bash";
		if (session.isStreaming) return "agent running";
		if (this.pendingMessageCount(session) > 0) return "queued";
		return "active";
	}

	private clearStaleActiveActivity(session: PiAgentSession): void {
		const current = this.activities.get(session.sessionId);
		if (current?.phase !== "active" || this.hasActiveWork(session)) return;
		const at = new Date().toISOString();
		const stored = { phase: "idle" as const, label: "idle", at };
		this.activities.set(session.sessionId, stored);
		const activity = { sessionId: session.sessionId, ...stored };
		this.events.publish(session.sessionId, { type: "activity.update", activity });
		this.events.publishGlobal({ type: "activity.update", activity });
	}
}

export function modelToClientModel(model: PiAgentSession["model"]): ClientSessionModel {
	if (model === undefined) return {};
	const name = getString(model, "name");
	const reasoning = getProperty(model, "reasoning");
	return {
		provider: model.provider,
		id: model.id,
		...(name === undefined ? {} : { name }),
		contextWindow: model.contextWindow,
		...(reasoning === undefined ? {} : { reasoning }),
	};
}

function getString(value: unknown, key: string): string | undefined {
	return getStringFromValue(getProperty(value, key));
}

function getStringFromValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function getBoolean(value: unknown, key: string): boolean | undefined {
	const field = getProperty(value, key);
	return typeof field === "boolean" ? field : undefined;
}

function getProperty(value: unknown, key: string): unknown {
	if (typeof value !== "object" || value === null) return undefined;
	return (value as Record<string, unknown>)[key];
}
