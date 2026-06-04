import type { RealtimeEvent, TerminalUiEvent, WorkspaceActivity } from "../api";
import type { GlobalSessionEvent } from "../sessionSocket";

export interface RealtimeEventControllerDependencies {
	applyWorkspaceActivity: (activity: WorkspaceActivity) => void;
	applyGlobalSessionEvent: (event: GlobalSessionEvent) => void;
	applyTerminalEvent: (event: TerminalUiEvent) => { clearedSelectedTerminal: boolean };
	onSelectedTerminalCleared: () => void;
	refreshWorkspaceDeletionRuns: () => void;
}

export class RealtimeEventController {
	private readonly applyWorkspaceActivity: RealtimeEventControllerDependencies["applyWorkspaceActivity"];
	private readonly applyGlobalSessionEvent: RealtimeEventControllerDependencies["applyGlobalSessionEvent"];
	private readonly applyTerminalEvent: RealtimeEventControllerDependencies["applyTerminalEvent"];
	private readonly onSelectedTerminalCleared: RealtimeEventControllerDependencies["onSelectedTerminalCleared"];
	private readonly refreshWorkspaceDeletionRuns: RealtimeEventControllerDependencies["refreshWorkspaceDeletionRuns"];

	constructor(deps: RealtimeEventControllerDependencies) {
		this.applyWorkspaceActivity = deps.applyWorkspaceActivity;
		this.applyGlobalSessionEvent = deps.applyGlobalSessionEvent;
		this.applyTerminalEvent = deps.applyTerminalEvent;
		this.onSelectedTerminalCleared = deps.onSelectedTerminalCleared;
		this.refreshWorkspaceDeletionRuns = deps.refreshWorkspaceDeletionRuns;
	}

	handle(event: RealtimeEvent): void {
		if (event.type === "workspace.activity") {
			this.applyWorkspaceActivity(event.activity);
			return;
		}
		if (isTerminalEvent(event)) {
			const result = this.applyTerminalEvent(event);
			if (result.clearedSelectedTerminal) this.onSelectedTerminalCleared();
			if (event.type === "terminal.exited") this.refreshWorkspaceDeletionRuns();
			return;
		}
		this.applyGlobalSessionEvent(event);
	}
}

function isTerminalEvent(event: RealtimeEvent): event is TerminalUiEvent {
	return event.type === "terminal.created" || event.type === "terminal.exited" || event.type === "terminal.closed";
}
