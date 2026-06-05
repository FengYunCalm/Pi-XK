import type { TerminalCommandRun, Workspace } from "../api";
import type { TerminalCommandRunsInternalRuntime } from "../plugins/types";
import {
	isWorkspaceDeletionPending,
	isWorkspaceDeletionRunPending,
	latestWorkspaceDeletionRuns,
	targetWorkspaceIdForRun,
	workspaceDeletionMetadata,
	workspaceDeletionRunFilter,
} from "../workspaceDeletion";
import type { GetState, SetState } from "./types";
import { canDeleteWorkspace } from "./workspaceController";

export interface WorkspaceDeletionControllerDependencies {
	terminalCommandRunsForOrigin: (origin: string) => TerminalCommandRunsInternalRuntime;
	mainWorkspaceForProject: (projectId: string) => Promise<Workspace | undefined>;
	refreshAfterWorkspaceDeleted: (projectId: string, workspaceId: string) => Promise<void>;
	confirm?: (message: string) => boolean;
	setInterval?: typeof globalThis.setInterval;
	clearInterval?: typeof globalThis.clearInterval;
}

export class WorkspaceDeletionController {
	private readonly getState: GetState;
	private readonly setState: SetState;
	private readonly terminalCommandRunsForOrigin: WorkspaceDeletionControllerDependencies["terminalCommandRunsForOrigin"];
	private readonly mainWorkspaceForProject: WorkspaceDeletionControllerDependencies["mainWorkspaceForProject"];
	private readonly refreshAfterWorkspaceDeleted: WorkspaceDeletionControllerDependencies["refreshAfterWorkspaceDeleted"];
	private readonly confirm: (message: string) => boolean;
	private readonly setTimer: typeof globalThis.setInterval;
	private readonly clearTimer: typeof globalThis.clearInterval;
	private pollTimer: ReturnType<typeof globalThis.setInterval> | undefined;
	private refreshingRuns = false;
	private readonly handledRunIds = new Set<string>();

	constructor(getState: GetState, setState: SetState, deps: WorkspaceDeletionControllerDependencies) {
		this.getState = getState;
		this.setState = setState;
		this.terminalCommandRunsForOrigin = deps.terminalCommandRunsForOrigin;
		this.mainWorkspaceForProject = deps.mainWorkspaceForProject;
		this.refreshAfterWorkspaceDeleted = deps.refreshAfterWorkspaceDeleted;
		this.confirm = deps.confirm ?? ((message) => globalThis.confirm(message));
		this.setTimer = deps.setInterval ?? globalThis.setInterval;
		this.clearTimer = deps.clearInterval ?? globalThis.clearInterval;
	}

	dispose(): void {
		this.stopPolling();
	}

	async deleteWorkspace(workspace = this.getState().selectedWorkspace): Promise<void> {
		if (workspace === undefined) return;
		if (!canDeleteWorkspace(workspace)) {
			this.setState({ error: "Only secondary Git worktrees can be deleted" });
			return;
		}
		if (isWorkspaceDeletionPending(this.getState(), workspace)) return;
		const label = workspace.branch ?? workspace.label;
		const confirmed = this.confirm(
			`Delete workspace ${label}?\n\nThis will run git worktree remove and delete:\n${workspace.path}\n\nThe Git branch will not be deleted.`,
		);
		if (!confirmed) return;

		try {
			const mainWorkspace = await this.mainWorkspaceForProject(workspace.projectId);
			if (mainWorkspace === undefined) {
				this.setState({ error: "Project main workspace not found" });
				return;
			}
			const handle = await this.terminalCommandRunsForOrigin("core").runCommand({
				workspace: mainWorkspace,
				title: `Delete workspace: ${label}`,
				command: `git worktree remove ${shellQuote(workspace.path)}`,
				open: true,
				metadata: workspaceDeletionMetadata(workspace),
			});
			this.recordRun(handle.run);
			void handle.completed
				.then((run) => this.handleCompletedRun(run))
				.catch((error: unknown) => {
					this.setState({ error: `Workspace deletion failed. See terminal output. ${errorMessage(error)}` });
				});
		} catch (error) {
			this.setState({ error: `Failed to start workspace deletion: ${errorMessage(error)}` });
		}
	}

	async refreshRuns(): Promise<void> {
		if (this.refreshingRuns) return;
		const project = this.getState().selectedProject;
		if (project === undefined) {
			this.setState({ workspaceDeletionRuns: {} });
			this.updatePolling();
			return;
		}

		this.refreshingRuns = true;
		try {
			const runs = await this.terminalCommandRunsForOrigin("core").listCommandRuns(workspaceDeletionRunFilter(project.id));
			const latestRuns = latestWorkspaceDeletionRuns(runs);
			this.setState({ workspaceDeletionRuns: latestRuns });
			for (const run of Object.values(latestRuns)) {
				if (!isWorkspaceDeletionRunPending(run)) await this.handleCompletedRun(run);
			}
		} catch (error) {
			console.warn("Failed to refresh workspace deletion runs", error);
		} finally {
			this.refreshingRuns = false;
			this.updatePolling();
		}
	}

	private recordRun(run: TerminalCommandRun): void {
		const workspaceId = targetWorkspaceIdForRun(run);
		if (workspaceId === undefined) return;
		this.setState({ workspaceDeletionRuns: { ...this.getState().workspaceDeletionRuns, [workspaceId]: run } });
		this.updatePolling();
	}

	private updatePolling(): void {
		const hasPendingDeletion = Object.values(this.getState().workspaceDeletionRuns).some(isWorkspaceDeletionRunPending);
		if (hasPendingDeletion && this.pollTimer === undefined) {
			this.pollTimer = this.setTimer(() => {
				void this.refreshRuns();
			}, 1000);
			return;
		}
		if (!hasPendingDeletion) this.stopPolling();
	}

	private stopPolling(): void {
		if (this.pollTimer !== undefined) this.clearTimer(this.pollTimer);
		this.pollTimer = undefined;
	}

	private async handleCompletedRun(run: TerminalCommandRun): Promise<void> {
		if (this.handledRunIds.has(run.id)) return;
		const workspaceId = targetWorkspaceIdForRun(run);
		if (workspaceId === undefined) return;

		if (run.status === "succeeded") {
			await this.refreshAfterWorkspaceDeleted(run.projectId, workspaceId);
			this.setState({ workspaceDeletionRuns: omitWorkspaceDeletionRun(this.getState().workspaceDeletionRuns, workspaceId) });
			this.handledRunIds.add(run.id);
			this.updatePolling();
			return;
		}

		if (run.status === "failed") {
			this.setState({ error: "Workspace deletion failed. See terminal output." });
			this.handledRunIds.add(run.id);
			this.updatePolling();
		}
	}
}

function omitWorkspaceDeletionRun(
	runs: Record<string, TerminalCommandRun>,
	workspaceId: string,
): Record<string, TerminalCommandRun> {
	return Object.fromEntries(Object.entries(runs).filter(([candidate]) => candidate !== workspaceId));
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
