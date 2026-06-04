import type { SessionInfo } from "../api";

export interface SessionSelectionMemory {
	latestSessionId(cwd: string): string | undefined;
	rememberSession(session: SessionInfo): void;
	forgetWorkspace(cwd: string): void;
}

export class InMemorySessionSelectionMemory implements SessionSelectionMemory {
	private readonly sessionIdsByCwd = new Map<string, string>();

	latestSessionId(cwd: string): string | undefined {
		return this.sessionIdsByCwd.get(cwd);
	}

	rememberSession(session: SessionInfo): void {
		this.sessionIdsByCwd.set(session.cwd, session.id);
	}

	forgetWorkspace(cwd: string): void {
		this.sessionIdsByCwd.delete(cwd);
	}
}

export function selectPreferredSession(
	sessions: SessionInfo[],
	options?: { targetSessionId?: string | undefined; latestSessionId?: string | undefined },
): SessionInfo | undefined {
	const targetSessionId = options?.targetSessionId;
	if (targetSessionId !== undefined && targetSessionId !== "") return sessionByIdOrPrefix(sessions, targetSessionId);

	const latestSessionId = options?.latestSessionId;
	if (latestSessionId !== undefined && latestSessionId !== "")
		return sessions.find((session) => session.id === latestSessionId) ?? sessions[0];

	return sessions[0];
}

function sessionByIdOrPrefix(sessions: SessionInfo[], sessionId: string): SessionInfo | undefined {
	return sessions.find((session) => session.id === sessionId || session.id.startsWith(sessionId));
}
