import type { Project } from "../api";
import type { AppState } from "../appState";
import { queryNamespace, readNamespacedString as defaultReadNamespacedString } from "../namespacedQueryArgs";
import type { QualifiedContributionId } from "../plugins/types";
import { type AppRoute, readRoute as defaultReadRoute } from "../route";
import type { GetState, SetState, RouteTarget } from "./types";

const TERMINAL_ROUTE_NAMESPACE = queryNamespace("core:workspace.terminal");
const FILE_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");
const GIT_ROUTE_NAMESPACE = queryNamespace("core:workspace.git");

export interface RouteRestoreControllerDependencies {
	defaultRouteView: () => AppState["mainView"];
	selectProject: (project: Project, target: RouteTarget) => Promise<void>;
	rememberSelectedTerminal: (terminalId: string) => void;
	refreshRestoredTool: (tool: QualifiedContributionId | undefined, selectedFilePath: string | undefined) => Promise<void>;
	updateGitPolling: () => void;
	readRoute?: () => AppRoute;
	readNamespacedString?: (namespace: string, key: string) => string | undefined;
}

export class RouteRestoreController {
	private readonly getState: GetState;
	private readonly setState: SetState;
	private readonly defaultRouteView: RouteRestoreControllerDependencies["defaultRouteView"];
	private readonly selectProject: RouteRestoreControllerDependencies["selectProject"];
	private readonly rememberSelectedTerminal: RouteRestoreControllerDependencies["rememberSelectedTerminal"];
	private readonly refreshRestoredTool: RouteRestoreControllerDependencies["refreshRestoredTool"];
	private readonly updateGitPolling: RouteRestoreControllerDependencies["updateGitPolling"];
	private readonly readRoute: () => AppRoute;
	private readonly readNamespacedString: (namespace: string, key: string) => string | undefined;
	private restoring = false;
	private restoredTerminalId: string | undefined;

	constructor(getState: GetState, setState: SetState, deps: RouteRestoreControllerDependencies) {
		this.getState = getState;
		this.setState = setState;
		this.defaultRouteView = deps.defaultRouteView;
		this.selectProject = deps.selectProject;
		this.rememberSelectedTerminal = deps.rememberSelectedTerminal;
		this.refreshRestoredTool = deps.refreshRestoredTool;
		this.updateGitPolling = deps.updateGitPolling;
		this.readRoute = deps.readRoute ?? defaultReadRoute;
		this.readNamespacedString = deps.readNamespacedString ?? defaultReadNamespacedString;
	}

	get isRestoring(): boolean {
		return this.restoring;
	}

	get restoringTerminalId(): string | undefined {
		return this.restoredTerminalId;
	}

	async restore(updateUrl: boolean): Promise<void> {
		const route = this.readRoute();
		const selectedFilePath = this.readNamespacedString(FILE_ROUTE_NAMESPACE, "file");
		const selectedDiffPath = this.readNamespacedString(GIT_ROUTE_NAMESPACE, "diff");
		const selectedTerminalId = this.readNamespacedString(TERMINAL_ROUTE_NAMESPACE, "terminal");
		this.restoring = true;
		this.restoredTerminalId = selectedTerminalId;
		try {
			this.setState({
				workspaceTool: route.tool ?? this.getState().workspaceTool,
				mainView: route.view ?? this.defaultRouteView(),
				selectedFilePath,
				selectedDiffPath,
				selectedTerminalId,
			});
			if (route.projectId === undefined || route.projectId === "") return;
			if (this.routeMatchesCurrentSelection(route)) {
				if (selectedTerminalId !== undefined) this.rememberSelectedTerminal(selectedTerminalId);
				await this.refreshRestoredTool(route.tool, selectedFilePath);
				this.updateGitPolling();
				return;
			}
			const project = this.getState().projects.find((candidate) => candidate.id === route.projectId);
			if (project === undefined) return;
			await this.selectProject(project, {
				workspaceId: route.workspaceId,
				sessionId: route.sessionId,
				updateUrl,
			});
			this.setState({ selectedFilePath, selectedDiffPath, selectedTerminalId });
			if (selectedTerminalId !== undefined) this.rememberSelectedTerminal(selectedTerminalId);
			await this.refreshRestoredTool(route.tool, selectedFilePath);
			this.updateGitPolling();
		} finally {
			this.restoring = false;
			this.restoredTerminalId = undefined;
		}
	}

	private routeMatchesCurrentSelection(route: AppRoute): boolean {
		const state = this.getState();
		return (
			route.workspaceId !== undefined &&
			route.workspaceId !== "" &&
			state.selectedProject?.id === route.projectId &&
			state.selectedWorkspace?.id === route.workspaceId &&
			state.selectedSession?.id === route.sessionId
		);
	}
}
