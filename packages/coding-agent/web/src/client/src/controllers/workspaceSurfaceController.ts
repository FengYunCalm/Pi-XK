import { isSessionActive } from "../../../shared/activity";
import type { AppState } from "../appState";
import type { QualifiedContributionId } from "../plugins/types";
import type { Workspace } from "../api";
import type { GetState, SetState, UpdateUrl } from "./types";

export interface WorkspaceSurfaceControllerDependencies {
	refreshFiles: () => Promise<void>;
	restoreFile: (path: string) => Promise<void>;
	refreshGit: () => Promise<void>;
	updateGitPolling: () => void;
	refreshActiveTerminals: (workspace: Workspace) => Promise<void>;
}

export class WorkspaceSurfaceController {
	private readonly getState: GetState;
	private readonly setState: SetState;
	private readonly updateUrl: UpdateUrl;
	private terminalAutoStartWorkspaceId: string | undefined;
	private readonly refreshFiles: WorkspaceSurfaceControllerDependencies["refreshFiles"];
	private readonly restoreFile: WorkspaceSurfaceControllerDependencies["restoreFile"];
	private readonly refreshGit: WorkspaceSurfaceControllerDependencies["refreshGit"];
	private readonly updateGitPolling: WorkspaceSurfaceControllerDependencies["updateGitPolling"];
	private readonly refreshActiveTerminals: WorkspaceSurfaceControllerDependencies["refreshActiveTerminals"];

	constructor(getState: GetState, setState: SetState, updateUrl: UpdateUrl, deps: WorkspaceSurfaceControllerDependencies) {
		this.getState = getState;
		this.setState = setState;
		this.updateUrl = updateUrl;
		this.refreshFiles = deps.refreshFiles;
		this.restoreFile = deps.restoreFile;
		this.refreshGit = deps.refreshGit;
		this.updateGitPolling = deps.updateGitPolling;
		this.refreshActiveTerminals = deps.refreshActiveTerminals;
	}

	openWorkspaceTool(tool: QualifiedContributionId): void {
		if (tool === "core:workspace.terminal") this.terminalAutoStartWorkspaceId = this.getState().selectedWorkspace?.id;
		this.setState({ workspaceTool: tool, mainView: tool });
		this.updateUrl();
		this.refreshSelectedTool(tool);
		this.updateGitPolling();
	}

	selectMainView(view: AppState["mainView"]): void {
		if (view !== "navigation" && view !== "chat") {
			this.openWorkspaceTool(view);
			return;
		}
		this.setState({ mainView: view });
		this.updateUrl();
		this.updateGitPolling();
	}

	async refreshCurrent(): Promise<void> {
		const workspace = this.getState().selectedWorkspace;
		const state = this.getState();
		const tool = state.mainView !== "chat" && state.mainView !== "navigation" ? state.mainView : state.workspaceTool;
		if (tool === "core:workspace.files") await this.refreshFiles();
		else if (tool === "core:workspace.git") await this.refreshGit();
		else if (tool === "core:workspace.terminal" && workspace !== undefined) await this.refreshActiveTerminals(workspace);
	}

	async refreshRestoredTool(
		tool: QualifiedContributionId | undefined,
		selectedFilePath: string | undefined,
	): Promise<void> {
		if (tool === "core:workspace.files") await this.refreshFiles();
		if (tool === "core:workspace.files" && selectedFilePath !== undefined) await this.restoreFile(selectedFilePath);
		if (tool === "core:workspace.git") await this.refreshGit();
	}

	refreshSelectedTool(tool: QualifiedContributionId): void {
		if (tool === "core:workspace.files") void this.refreshFiles();
		if (tool === "core:workspace.git") void this.refreshGit();
	}

	handleActivityTransition(previous: AppState, next: AppState): void {
		const wasActive = isSessionActive(previous.status, previous.activity);
		const nowActive = isSessionActive(next.status, next.activity);
		if (wasActive && !nowActive) {
			this.setState({ fileTreeStale: true, gitStale: true });
			this.refreshSelectedTool(this.getState().workspaceTool);
		}
	}

	resetTerminalAutoStart(): void {
		this.terminalAutoStartWorkspaceId = undefined;
	}

	shouldAutoStartTerminal(workspaceId: string): boolean {
		return this.terminalAutoStartWorkspaceId === workspaceId;
	}
}
