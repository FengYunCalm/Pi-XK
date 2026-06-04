import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { AppAction } from "../actions";
import {
	type Project,
	type SessionInfo,
	type ThinkingLevel,
	type Workspace,
} from "../api";
import { AppShellController } from "../appShell/appShellController";
import { MobileNavigationController, type NavigationSection } from "../appShell/navigationState";
import { mainViewClass, PanelCollapseController } from "../appShell/panelCollapseController";
import { type AppState, initialAppState } from "../appState";
import { AppLifecycleRefreshController } from "../controllers/appLifecycleRefreshController";
import { createAppControllers } from "../controllers/appControllers";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import { RealtimeEventController } from "../controllers/realtimeEventController";
import { RouteRestoreController } from "../controllers/routeRestoreController";
import { TerminalActivityController } from "../controllers/terminalActivityController";
import { WorkspaceDeletionController } from "../controllers/workspaceDeletionController";
import { WorkspaceSurfaceController } from "../controllers/workspaceSurfaceController";
import { KeyboardShortcutDispatcher } from "../keyboardShortcuts";
import { queryNamespace, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { createBuiltinPluginRegistry } from "../plugins/builtin";
import { loadExternalPlugins } from "../plugins/external";
import { installPluginRuntimeScope, installWorkspacePanelScope } from "../plugins/registry";
import type {
	PluginRuntimeContext,
	QualifiedContributionId,
	QualifiedThemeContribution,
	QualifiedThemePairContribution,
	QualifiedWorkspacePanelContribution,
	WorkspacePanelContext,
} from "../plugins/types";
import { writeRoute } from "../route";
import { TerminalCommandRunRegistry } from "../runtime/terminalCommandRunRegistry";
import { RealtimeSocket } from "../sessionSocket";
import {
	applyPiWebTheme,
	CLASSIC_THEME_ID,
	DEFAULT_THEME_PREFERENCE,
	findThemePairForTheme,
	readStoredThemePreference,
	resolveThemePreference,
	type ThemePreference,
	type ThemePreferenceResolution,
	writeStoredThemePreference,
} from "../theme";
import { pendingWorkspaceDeletionIds } from "../workspaceDeletion";
import "./ProjectList";
import "./WorkspaceList";
import "./SessionList";
import "./ChatView";
import type { ChatView } from "./ChatView";
import "./PromptEditor";
import type { PromptEditor } from "./PromptEditor";
import "./StatusBar";
import "./CommandPicker";
import "./ActionPalette";
import "./AuthDialog";
import "./ProjectDialog";
import "./WorkspacePanel";
import type { WorkspacePanelEmptyState } from "./WorkspacePanel";
import "./appShell/AppContextBar";
import "./appShell/AppMobileMainTabs";
import type { AppMobileMainTab } from "./appShell/AppMobileMainTabs";
import "./appShell/AppNavigationPanel";
import "./appShell/AppPanelEdgeControl";
import "./appShell/AppRefreshControl";
import { appStyles } from "./shared";

const GLOBAL_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;
const THEME_AUTO_ON_VALUE = "auto:on";
const THEME_AUTO_OFF_VALUE = "auto:off";
const THEME_OPTION_PREFIX = "theme:";
const TERMINAL_ROUTE_NAMESPACE = queryNamespace("core:workspace.terminal");

@customElement("pi-web-app")
export class PiWebApp extends LitElement {
	@state() private state: AppState = initialAppState();
	@query("chat-view") private chatView?: ChatView;
	@query("prompt-editor") private promptEditor?: PromptEditor;

	private readonly controllers = createAppControllers({
		getState: () => this.state,
		setState: (patch) => {
			this.setState(patch);
		},
		updateUrl: (options) => {
			this.updateUrl(options);
		},
	});
	private readonly sessions = this.controllers.sessions;
	private readonly activity = this.controllers.activity;
	private readonly auth = this.controllers.auth;
	private readonly workspaces = this.controllers.workspaces;
	private readonly projects = this.controllers.projects;
	private readonly files = this.controllers.files;
	private readonly git = this.controllers.git;
	private readonly keyboard = new KeyboardShortcutDispatcher();
	private readonly realtime = new RealtimeSocket();
	private readonly terminalActivity = new TerminalActivityController(
		() => this.state,
		(patch) => {
			this.setState(patch);
		},
	);
	private readonly appShell = new AppShellController(this);
	private readonly panelCollapse = new PanelCollapseController(this);
	private readonly mobileNavigation = new MobileNavigationController(
		this,
		() => this.state,
		() => this.appShell.isMobileNavigationLayout,
	);
	private readonly systemLightThemeMedia =
		typeof window !== "undefined" && "matchMedia" in window
			? window.matchMedia("(prefers-color-scheme: light)")
			: undefined;
	private readonly terminalCommandRuns = new TerminalCommandRunRegistry({
		openTerminal: (workspace, options) => this.openRuntimeTerminal(workspace, options),
	});
	private readonly piWebStatus = new PiWebStatusController((patch) => {
		this.setState(patch);
	});
	private readonly realtimeEvents = new RealtimeEventController({
		applyWorkspaceActivity: (activity) => this.activity.applyWorkspaceActivity(activity),
		applyGlobalSessionEvent: (event) => this.sessions.applyGlobalEvent(event),
		applyTerminalEvent: (event) => this.terminalActivity.applyTerminalEvent(event),
		onSelectedTerminalCleared: () => {
			this.writeSelectedTerminalToUrl(undefined, { replace: true });
		},
		refreshWorkspaceDeletionRuns: () => {
			void this.workspaceDeletion.refreshRuns();
		},
	});
	private readonly workspaceDeletion = new WorkspaceDeletionController(
		() => this.state,
		(patch) => {
			this.setState(patch);
		},
		{
			terminalCommandRunsForOrigin: (origin) => this.terminalCommandRunsForOrigin(origin),
			mainWorkspaceForProject: (projectId) => this.mainWorkspaceForProject(projectId),
			refreshAfterWorkspaceDeleted: (projectId, workspaceId) =>
				this.workspaces.refreshAfterWorkspaceDeleted(projectId, workspaceId),
		},
	);
	private readonly workspaceSurface = new WorkspaceSurfaceController(
		() => this.state,
		(patch) => {
			this.setState(patch);
		},
		(options) => {
			this.updateUrl(options);
		},
		{
			refreshFiles: () => this.files.refreshFiles(),
			restoreFile: (path) => this.files.restoreFile(path),
			refreshGit: () => this.git.refreshGit(),
			updateGitPolling: () => this.git.updatePolling(),
			refreshActiveTerminals: (workspace) => this.refreshActiveTerminals(workspace),
		},
	);
	private readonly routeRestore = new RouteRestoreController(
		() => this.state,
		(patch) => {
			this.setState(patch);
		},
		{
			defaultRouteView: () => this.defaultRouteView(),
			selectProject: (project, target) => this.workspaces.selectProject(project, target),
			rememberSelectedTerminal: (terminalId) => this.terminalActivity.rememberSelectedTerminal(terminalId),
			refreshRestoredTool: (tool, selectedFilePath) =>
				this.workspaceSurface.refreshRestoredTool(tool, selectedFilePath),
			updateGitPolling: () => this.git.updatePolling(),
		},
	);
	private readonly plugins = createBuiltinPluginRegistry();
	private themePreference: ThemePreference = readStoredThemePreference() ?? DEFAULT_THEME_PREFERENCE;
	@state() private activeThemeId: QualifiedContributionId = CLASSIC_THEME_ID;
	@state() private isRefreshingApp = false;
	private readonly appLifecycleRefresh = new AppLifecycleRefreshController({
		isRefreshing: () => this.isRefreshingApp,
		setRefreshing: (refreshing) => {
			this.isRefreshingApp = refreshing;
		},
		repairViewportPosition: () => this.appShell.repairViewportPosition(),
		refreshSelectedSession: () => this.sessions.refreshSelectedSession(),
		refreshPiWebStatus: () => this.piWebStatus.refresh(),
		refreshWorkspaceActivity: () => this.activity.refresh(),
		refreshWorkspaceDeletionRuns: () => this.workspaceDeletion.refreshRuns(),
		refreshWorkspaceSurface: () => this.workspaceSurface.refreshCurrent(),
	});
	private readonly onPopState = () => void this.withChatScrollTransition(() => this.routeRestore.restore(false));
	private readonly onPageShow = () => {
		this.appLifecycleRefresh.handlePageShow();
	};
	private readonly onFocus = () => {
		this.appLifecycleRefresh.handleFocus();
	};
	private readonly onVisibilityChange = () => {
		this.appLifecycleRefresh.handleVisibilityChange(document.visibilityState);
	};
	private readonly onSystemLightThemeChange = () => {
		if (this.themePreference.auto) this.applyPreferredTheme(false);
	};
	private readonly onKeyDown = (event: KeyboardEvent) => {
		if (this.keyboard.handle(event, this.getActions())) {
			event.preventDefault();
			event.stopPropagation();
		}
	};

	protected override willUpdate(): void {
		this.toggleAttribute("pwa-display-mode", this.appShell.isPwaDisplayMode);
	}

	override connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("popstate", this.onPopState);
		window.addEventListener("pageshow", this.onPageShow);
		window.addEventListener("focus", this.onFocus);
		document.addEventListener("visibilitychange", this.onVisibilityChange);
		window.addEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
		this.systemLightThemeMedia?.addEventListener("change", this.onSystemLightThemeChange);
		this.applyPreferredTheme(false);
		this.connectRealtime();
		this.piWebStatus.startPolling();
		void this.piWebStatus.refresh();
		void this.appLifecycleRefresh.refreshWorkspaceActivity();
		void this.loadExternalPlugins();
		void this.loadProjectsAndRestoreRoute();
	}

	override disconnectedCallback(): void {
		window.removeEventListener("popstate", this.onPopState);
		window.removeEventListener("pageshow", this.onPageShow);
		window.removeEventListener("focus", this.onFocus);
		document.removeEventListener("visibilitychange", this.onVisibilityChange);
		window.removeEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
		this.systemLightThemeMedia?.removeEventListener("change", this.onSystemLightThemeChange);
		this.keyboard.reset();
		this.auth.dispose();
		this.sessions.dispose();
		this.realtime.close();
		this.git.dispose();
		this.piWebStatus.dispose();
		this.workspaceDeletion.dispose();
		super.disconnectedCallback();
	}

	private setState(patch: Partial<AppState>) {
		if (!patchChangesState(this.state, patch)) return;
		const previous = this.state;
		this.state = { ...this.state, ...patch };
		this.handleActivityTransition(previous, this.state);
		this.handleWorkspaceChange(previous, this.state);
	}

	private async loadProjectsAndRestoreRoute() {
		await this.projects.loadProjects();
		await this.withChatScrollTransition(() => this.routeRestore.restore(false));
		await this.workspaceDeletion.refreshRuns();
	}

	private async refreshAppData(): Promise<void> {
		await this.appLifecycleRefresh.refreshAppData();
	}

	private hardReloadApp(): void {
		window.location.reload();
	}

	private async withChatScrollTransition(action: () => Promise<void>) {
		this.chatView?.saveScrollPosition();
		await action();
		await this.updateComplete;
		await this.chatView?.updateComplete;
		await nextFrame();
		this.chatView?.restoreScrollPosition();
		if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
	}

	private shouldAutoFocusPrompt(): boolean {
		return this.appShell.shouldAutoFocusPrompt();
	}

	private async withChatPrependTransition(action: () => Promise<void>) {
		await action();
		await this.updateComplete;
		await this.chatView?.updateComplete;
	}

	private defaultRouteView(): AppState["mainView"] {
		return this.appShell.defaultRouteView();
	}

	private updateUrl(options?: { replace?: boolean | undefined }) {
		writeRoute(
			{
				projectId: this.state.selectedProject?.id,
				workspaceId: this.state.selectedWorkspace?.id,
				sessionId: this.state.selectedSession?.id,
				tool: this.state.workspaceTool,
				view: this.state.mainView === "navigation" ? undefined : this.state.mainView,
			},
			options,
		);
	}

	private openWorkspaceTool(tool: QualifiedContributionId) {
		this.workspaceSurface.openWorkspaceTool(tool);
	}

	private openTerminal(options?: { terminalId?: string | undefined }): void {
		if (options?.terminalId !== undefined) this.selectTerminal(options.terminalId, { replace: true });
		this.openWorkspaceTool("core:workspace.terminal");
	}

	private terminalCommandRunsForOrigin(origin: string) {
		return this.terminalCommandRuns.forOrigin(origin);
	}

	private async openRuntimeTerminal(
		workspace: Workspace | undefined,
		options?: { terminalId?: string | undefined },
	): Promise<void> {
		if (workspace !== undefined && this.state.selectedWorkspace?.id !== workspace.id)
			await this.workspaces.selectWorkspace(workspace);
		this.openTerminal(options);
	}

	private selectTerminal(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
		this.terminalActivity.rememberSelectedTerminal(terminalId);
		this.setState({ selectedTerminalId: terminalId });
		this.writeSelectedTerminalToUrl(terminalId, options);
	}

	private writeSelectedTerminalToUrl(
		terminalId: string | undefined,
		options?: { replace?: boolean | undefined },
	): void {
		setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", terminalId, options);
	}

	private selectMainView(view: AppState["mainView"]) {
		this.workspaceSurface.selectMainView(view);
	}

	private handleWorkspaceChange(previous: AppState, next: AppState) {
		if (previous.selectedWorkspace?.id === next.selectedWorkspace?.id) return;
		this.workspaceSurface.resetTerminalAutoStart();
		const selectedTerminalId = this.terminalActivity.resetForWorkspace(
			next.selectedWorkspace,
			this.routeRestore.isRestoring ? this.routeRestore.restoringTerminalId : undefined,
		);
		if (!this.routeRestore.isRestoring) this.writeSelectedTerminalToUrl(selectedTerminalId, { replace: true });
		if (next.selectedWorkspace === undefined) return;
		void this.refreshActiveTerminals(next.selectedWorkspace);
		void this.workspaceDeletion.refreshRuns();
		this.workspaceSurface.refreshSelectedTool(next.workspaceTool);
		this.git.updatePolling();
	}

	private connectRealtime(): void {
		this.realtime.connect(
			(event) => {
				this.realtimeEvents.handle(event);
			},
			() => {
				const workspace = this.state.selectedWorkspace;
				if (workspace !== undefined) void this.refreshActiveTerminals(workspace);
				void this.appLifecycleRefresh.refreshWorkspaceActivity();
			},
		);
	}

	private async refreshActiveTerminals(workspace: Workspace): Promise<void> {
		await this.terminalActivity.refreshActiveTerminals(workspace);
	}

	private handleActivityTransition(previous: AppState, next: AppState) {
		this.workspaceSurface.handleActivityTransition(previous, next);
	}

	private renderWorkspacePanel() {
		const workspace = this.state.selectedWorkspace;
		const panelContext = workspace === undefined ? undefined : this.createWorkspacePanelContext(workspace);
		const workspaceLabelItems =
			workspace === undefined ? [] : this.plugins.getWorkspaceLabelItems(this.state, workspace);
		const emptyState = workspace === undefined ? this.workspacePanelEmptyState() : undefined;
		return html`
      <workspace-panel
        id="workspace-panel"
        .workspace=${workspace}
        .panelContext=${panelContext}
        .emptyState=${emptyState}
        .tool=${this.state.workspaceTool}
        .panels=${this.visibleWorkspacePanels()}
        .workspaceLabelItems=${workspaceLabelItems}
        .onSelectTool=${(tool: QualifiedContributionId) => {
				this.openWorkspaceTool(tool);
			}}
      ></workspace-panel>
    `;
	}

	private renderNavigationPanelEdgeControl() {
		return html`
      <app-panel-edge-control
        side="navigation"
        controls="navigation-panel"
        expandLabel="Expand navigation panel"
        collapseLabel="Collapse navigation panel"
        .collapsed=${this.panelCollapse.navigationPanelCollapsed}
        .onToggle=${() => {
				this.panelCollapse.toggleNavigationPanel();
			}}
      ></app-panel-edge-control>
    `;
	}

	private renderWorkspacePanelEdgeControl() {
		return html`
      <app-panel-edge-control
        side="workspace"
        controls="workspace-panel"
        expandLabel="Expand workspace panel"
        collapseLabel="Collapse workspace panel"
        .collapsed=${this.panelCollapse.workspacePanelCollapsed}
        .onToggle=${() => {
				this.panelCollapse.toggleWorkspacePanel();
			}}
      ></app-panel-edge-control>
    `;
	}

	private renderNavigationPanel(autoSwitchToChat: boolean) {
		const openChatAfter = (action: () => Promise<void>) =>
			this.withChatScrollTransition(async () => {
				await action();
				if (autoSwitchToChat) this.setState({ mainView: "chat" });
				if (autoSwitchToChat) this.updateUrl();
			});
		return html`
      <app-navigation-panel
        .projects=${this.state.projects}
        .selectedProject=${this.state.selectedProject}
        .workspaceActivities=${this.state.workspaceActivities}
        .workspacesByProjectId=${this.state.workspacesByProjectId}
        .workspaces=${this.state.workspaces}
        .selectedWorkspace=${this.state.selectedWorkspace}
        .deletingWorkspaceIds=${pendingWorkspaceDeletionIds(this.state.workspaceDeletionRuns)}
        .sessions=${this.state.sessions}
        .sessionStatuses=${this.state.sessionStatuses}
        .sessionActivities=${this.state.sessionActivities}
        .selectedSession=${this.state.selectedSession}
        .canStartSession=${!!this.state.selectedWorkspace}
        .collapsible=${this.appShell.isMobileNavigationLayout}
        .projectsCollapsed=${this.mobileNavigation.isCollapsed("projects")}
        .workspacesCollapsed=${this.mobileNavigation.isCollapsed("workspaces")}
        .sessionsCollapsed=${this.mobileNavigation.isCollapsed("sessions")}
        .workspaceLabelItems=${(workspace: Workspace) => this.plugins.getWorkspaceLabelItems(this.state, workspace)}
        .refreshControl=${this.appShell.shouldShowAppRefreshInHeader() ? this.renderAppRefresh() : undefined}
        .onShowActions=${() => {
				this.setState({ actionPaletteOpen: true });
			}}
        .onToggleProjects=${() => {
				this.mobileNavigation.toggle("projects");
			}}
        .onToggleWorkspaces=${() => {
				this.mobileNavigation.toggle("workspaces");
			}}
        .onToggleSessions=${() => {
				this.mobileNavigation.toggle("sessions");
			}}
        .onSelectProject=${(project: Project) =>
				this.withChatScrollTransition(async () => {
					this.mobileNavigation.expand("workspaces");
					await this.workspaces.selectProject(project);
				})}
        .onCloseProject=${(project: Project) => this.projects.closeProject(project.id)}
        .onSelectWorkspace=${(workspace: Workspace) =>
				this.withChatScrollTransition(async () => {
					this.mobileNavigation.expand("sessions");
					await this.workspaces.selectWorkspace(workspace);
				})}
        .onDeleteWorkspace=${(workspace: Workspace) => {
				void this.workspaceDeletion.deleteWorkspace(workspace);
			}}
        .onStartSession=${() => openChatAfter(() => this.sessions.startSession())}
        .onSelectSession=${(session: SessionInfo) => openChatAfter(() => this.sessions.selectSession(session))}
        .onDeleteCachedNewSession=${(session: SessionInfo) => this.sessions.deleteCachedNewSession(session)}
        .onDetachParentSession=${(session: SessionInfo) => this.sessions.detachParent(session)}
      ></app-navigation-panel>
    `;
	}

	private openNavigationSection(section: NavigationSection): void {
		this.mobileNavigation.open(section, () => {
			this.selectMainView("navigation");
		});
	}

	private visibleWorkspacePanels(): QualifiedWorkspacePanelContribution[] {
		const workspace = this.state.selectedWorkspace;
		if (workspace === undefined) return [];
		return this.plugins
			.getWorkspacePanels()
			.filter((panel) => panel.visible?.({ workspace, state: this.state }) ?? true);
	}

	private workspacePanelEmptyState(): WorkspacePanelEmptyState {
		const project = this.state.selectedProject;
		if (this.state.isLoadingProjects) {
			return {
				title: "Loading projects…",
				body: "Looking for projects you have added to PI WEB.",
			};
		}
		if (project === undefined) {
			return this.state.projects.length === 0
				? {
						title: "No projects yet",
						body: "Use Actions → Add Project to add a folder. Workspace tools will appear here after you choose a workspace.",
					}
				: {
						title: "Select a project",
						body: "Choose a project from the sidebar, then select a workspace to inspect files, Git, or terminals.",
					};
		}
		if (this.state.isLoadingWorkspaces) {
			return {
				title: "Loading workspaces…",
				body: `Preparing workspace tools for ${project.name}.`,
			};
		}
		if (this.state.workspaces.length === 0) {
			return {
				title: "No workspaces found",
				body: `${project.name} does not have any available workspaces. Try selecting the project again or re-adding it.`,
			};
		}
		return {
			title: "Select a workspace",
			body: `Choose a workspace in ${project.name} to inspect files, Git, or terminals.`,
		};
	}

	private sessionEmptyMessage(): string {
		if (this.state.isLoadingProjects) return "Loading projects…";
		if (this.state.selectedWorkspace !== undefined) return "Select or start a session.";
		if (this.state.selectedProject !== undefined) return "Select a workspace to start a session.";
		if (this.state.projects.length === 0) return "Add a project to start a session.";
		return "Select a project and workspace to start a session.";
	}

	private renderMobilePanelTitle(panel: QualifiedWorkspacePanelContribution) {
		const workspace = this.state.selectedWorkspace;
		if (workspace === undefined) return panel.title;
		const badge = panel.badge?.(this.createWorkspacePanelContext(workspace));
		if (badge === undefined || badge === "") return panel.title;
		return html`${panel.title} <span class="tab-badge">${badge}</span>`;
	}

	private createWorkspacePanelContext(workspace: Workspace): WorkspacePanelContext {
		const createContext = (origin: string): WorkspacePanelContext =>
			installWorkspacePanelScope(
				{
					workspace,
					state: this.state,
					piWebInternal: { terminalCommandRuns: this.terminalCommandRunsForOrigin(origin) },
					fileTree: this.state.fileTree,
					expandedDirs: this.state.expandedDirs,
					selectedFilePath: this.state.selectedFilePath,
					selectedFileContent: this.state.selectedFileContent,
					fileTreeStale: this.state.fileTreeStale,
					gitStatus: this.state.gitStatus,
					selectedDiffPath: this.state.selectedDiffPath,
					selectedDiff: this.state.selectedDiff,
					selectedStagedDiff: this.state.selectedStagedDiff,
					gitStale: this.state.gitStale,
					activeTerminalCount: this.state.activeTerminalCount,
					selectedTerminalId: this.state.selectedTerminalId,
					terminalAutoStart: this.workspaceSurface.shouldAutoStartTerminal(workspace.id),
					openTerminal: (options) => {
						this.openTerminal(options);
					},
					onRefreshFiles: () => {
						void this.files.refreshFiles();
					},
					onExpandDir: (path: string) => {
						void this.files.expandDir(path);
					},
					onSelectFile: (path: string) => {
						void this.files.selectFile(path);
					},
					onRefreshGit: () => {
						void this.git.refreshGit();
					},
					onSelectDiff: (path: string) => {
						void this.git.selectDiff(path);
					},
					onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => {
						this.selectTerminal(terminalId, options);
					},
				},
				createContext,
			);
		return createContext("core");
	}

	private getActions(): AppAction[] {
		return this.plugins.getActions(this.createPluginRuntimeContext());
	}

	private async loadExternalPlugins(): Promise<void> {
		try {
			const registrations = await loadExternalPlugins();
			for (const registration of registrations) {
				try {
					this.plugins.register(registration);
				} catch (error) {
					console.warn(`Failed to register PI WEB plugin ${registration.id}`, error);
				}
			}
			this.applyPreferredTheme(false);
			this.requestUpdate();
		} catch (error) {
			console.warn("Failed to load external PI WEB plugins", error);
		}
	}

	private createPluginRuntimeContext(): PluginRuntimeContext {
		const createContext = (origin: string): PluginRuntimeContext =>
			installPluginRuntimeScope(
				{
					state: this.state,
					piWebInternal: { terminalCommandRuns: this.terminalCommandRunsForOrigin(origin) },
					openActionPalette: () => {
						this.setState({ actionPaletteOpen: true });
					},
					focusPrompt: () => {
						this.promptEditor?.focusInput();
					},
					addProject: () => {
						this.setState({ projectDialogOpen: true });
					},
					configureAuth: () => this.auth.openLogin(),
					logoutAuth: () => this.auth.openLogout(),
					openThemePicker: () => {
						this.openThemeDialog();
					},
					selectMainView: (view) => {
						this.selectMainView(view);
					},
					selectWorkspaceTool: (tool) => {
						this.openWorkspaceTool(tool);
					},
					openTerminal: (options) => {
						this.openTerminal(options);
					},
					refreshFiles: () => this.files.refreshFiles(),
					refreshGit: () => this.git.refreshGit(),
					refreshAppData: () => this.refreshAppData(),
					reloadPage: () => {
						this.hardReloadApp();
					},
					deleteWorkspace: (workspace) => this.workspaceDeletion.deleteWorkspace(workspace),
					startSession: () => this.withChatScrollTransition(() => this.sessions.startSession()),
					deleteCachedNewSession: () => this.sessions.deleteCachedNewSession(),
					stopActiveWork: () => this.sessions.stopActiveWork(),
				},
				createContext,
			);
		return createContext("core");
	}

	private async mainWorkspaceForProject(projectId: string): Promise<Workspace | undefined> {
		let workspaces =
			this.state.selectedProject?.id === projectId
				? this.state.workspaces
				: this.state.workspacesByProjectId[projectId];
		if (workspaces === undefined || workspaces.length === 0)
			workspaces = await this.workspaces.refreshProjectWorkspaces(projectId);
		return workspaces.find((workspace) => workspace.isMain) ?? workspaces[0];
	}

	private runAction(action: AppAction): void {
		void Promise.resolve()
			.then(() => action.run())
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`Action failed: ${action.id}`, error);
				this.setState({ error: `Action failed: ${message}` });
			});
	}

	private async openModelDialog() {
		const models = await this.sessions.listModels();
		const currentProvider = this.state.status?.model?.provider;
		const currentId = this.state.status?.model?.id;
		this.setState({
			modelDialog: {
				title: "Select Model",
				...(currentProvider !== undefined && currentId !== undefined
					? { selectedValue: `${currentProvider}/${currentId}` }
					: {}),
				options: models.map((model) => {
					const provider = model.provider ?? "";
					const id = model.id ?? "";
					const isCurrent = provider === currentProvider && id === currentId;
					return {
						value: `${provider}/${id}`,
						label: `${id}${isCurrent ? " ✓ current" : ""}`,
						description: provider,
					};
				}),
			},
		});
	}

	private async pickModel(value: string) {
		this.setState({ modelDialog: undefined });
		const slash = value.indexOf("/");
		if (slash <= 0) return;
		await this.sessions.setModel(value.slice(0, slash), value.slice(slash + 1));
	}

	private openThemeDialog() {
		const themes = this.plugins.getThemes();
		const resolution = this.resolveCurrentThemePreference(themes);
		const selectedThemeId = resolution.selectedTheme?.id;
		const autoValue = this.themePreference.auto ? THEME_AUTO_OFF_VALUE : THEME_AUTO_ON_VALUE;
		this.setState({
			themeDialog: {
				title: "Select Theme",
				selectedValue: selectedThemeId === undefined ? autoValue : `${THEME_OPTION_PREFIX}${selectedThemeId}`,
				options: [
					{
						value: autoValue,
						label: `Auto ${this.themePreference.auto ? "✓ on" : "off"}`,
						description: this.autoThemeDescription(resolution),
					},
					...themes.map((theme) => ({
						value: `${THEME_OPTION_PREFIX}${theme.id}`,
						label: this.themeOptionLabel(theme, selectedThemeId),
						description: this.themeOptionDescription(theme),
					})),
				],
			},
		});
	}

	private pickTheme(value: string) {
		this.setState({ themeDialog: undefined });
		if (value === THEME_AUTO_ON_VALUE || value === THEME_AUTO_OFF_VALUE) {
			const selectedThemeId = this.resolveCurrentThemePreference().selectedTheme?.id;
			if (selectedThemeId === undefined) return;
			this.themePreference = { themeId: selectedThemeId, auto: value === THEME_AUTO_ON_VALUE };
			this.applyPreferredTheme(true);
			return;
		}
		if (!value.startsWith(THEME_OPTION_PREFIX)) return;
		const themeId = value.slice(THEME_OPTION_PREFIX.length);
		const theme = this.plugins.getThemes().find((candidate) => candidate.id === themeId);
		if (theme === undefined) return;
		this.themePreference = { themeId: theme.id, auto: this.themePreference.auto };
		this.applyPreferredTheme(true);
	}

	private applyPreferredTheme(persist: boolean): void {
		const theme = this.resolveCurrentThemePreference().activeTheme;
		if (theme === undefined) return;
		this.activeThemeId = theme.id;
		applyPiWebTheme(theme);
		if (persist) writeStoredThemePreference(this.themePreference);
	}

	private resolveCurrentThemePreference(themes = this.plugins.getThemes()): ThemePreferenceResolution {
		return resolveThemePreference({
			themes,
			themePairs: this.plugins.getThemePairs(),
			preference: this.themePreference,
			prefersLight: this.systemPrefersLight(),
		});
	}

	private themePairForTheme(themeId: QualifiedContributionId): QualifiedThemePairContribution | undefined {
		return findThemePairForTheme(this.plugins.getThemePairs(), themeId);
	}

	private systemPrefersLight(): boolean {
		return this.systemLightThemeMedia?.matches ?? false;
	}

	private autoThemeDescription(resolution: ThemePreferenceResolution): string {
		if (!this.themePreference.auto)
			return "Follow the system light/dark preference when the selected theme has a pair.";
		if (resolution.selectedTheme === undefined)
			return "Follow the system light/dark preference when the selected theme has a pair.";
		if (resolution.selectedThemePair === undefined)
			return "On, but the selected theme has no light/dark pair, so it will stay selected.";
		return `On · ${resolution.selectedThemePair.name} follows the system ${this.systemPrefersLight() ? "light" : "dark"} preference.`;
	}

	private themeOptionLabel(
		theme: QualifiedThemeContribution,
		selectedThemeId: QualifiedContributionId | undefined,
	): string {
		const markers = [
			...(theme.id === selectedThemeId ? ["selected"] : []),
			...(theme.id === this.activeThemeId && theme.id !== selectedThemeId ? ["active"] : []),
		];
		return markers.length === 0 ? theme.name : `${theme.name} ✓ ${markers.join(" · ")}`;
	}

	private themeOptionDescription(theme: QualifiedThemeContribution): string {
		const parts: string[] = [theme.colorScheme];
		if (this.themePairForTheme(theme.id) !== undefined) parts.push("auto pair");
		if (theme.description !== undefined) parts.push(theme.description);
		return parts.join(" · ");
	}

	private async openThinkingDialog() {
		const levels = await this.sessions.listThinkingLevels();
		const current = this.state.status?.thinkingLevel ?? "off";
		this.setState({
			thinkingDialog: {
				title: "Select Thinking Level",
				selectedValue: current,
				options: levels.map((level) => ({
					value: level,
					label: `${level}${level === current ? " ✓ current" : ""}`,
					description: thinkingDescription(level),
				})),
			},
		});
	}

	private async pickThinking(value: string) {
		this.setState({ thinkingDialog: undefined });
		if (isThinkingLevel(value)) await this.sessions.setThinkingLevel(value);
	}

	private sendPrompt(text: string, streamingBehavior?: "steer" | "followUp"): void {
		if (streamingBehavior === undefined && this.auth.handleSlashCommand(text)) return;
		void this.sessions.send(text, streamingBehavior);
	}

	private renderContextBar() {
		if (!this.appShell.isMobileNavigationLayout) return null;
		return html`
      <app-context-bar
        .project=${this.state.selectedProject}
        .workspace=${this.state.selectedWorkspace}
        .session=${this.state.selectedSession}
        .refreshControl=${this.appShell.shouldShowAppRefreshInContextBar() ? this.renderAppRefresh() : undefined}
        .onOpenSection=${(section: NavigationSection) => {
				this.openNavigationSection(section);
			}}
      ></app-context-bar>
    `;
	}

	private renderMobileMainTabs() {
		return html`
      <app-mobile-main-tabs
        .tabs=${this.mobileMainTabs()}
        .selectedView=${this.state.mainView}
        .onSelect=${(view: AppState["mainView"]) => {
				this.selectMainView(view);
			}}
      ></app-mobile-main-tabs>
    `;
	}

	private mobileMainTabs(): AppMobileMainTab[] {
		return [
			{ id: "navigation", label: "Sessions", className: "navigation-tab" },
			{ id: "chat", label: "Chat" },
			...this.visibleWorkspacePanels().map(
				(panel): AppMobileMainTab => ({ id: panel.id, label: this.renderMobilePanelTitle(panel) }),
			),
		];
	}

	private renderAppRefresh() {
		return html`<app-refresh-control .isRefreshing=${this.isRefreshingApp} .onRefresh=${() => this.refreshAppData()} .onReload=${() => {
			this.hardReloadApp();
		}}></app-refresh-control>`;
	}

	override render() {
		const state = this.state;
		return html`
      <a class="skip-link" href="#main-workbench">Skip to workbench</a>
      <div class=${this.panelCollapse.shellClass(state.mainView)}>
        <aside id="navigation-panel">${this.appShell.isMobileNavigationLayout ? null : this.renderNavigationPanel(false)}</aside>
        ${this.renderNavigationPanelEdgeControl()}
        <main id="main-workbench" class=${mainViewClass(state.mainView)} tabindex="-1" aria-label="Pi Web workbench">
          ${this.renderContextBar()}
          ${this.renderMobileMainTabs()}
          ${state.error ? html`<div class="error" role="alert">${state.error}</div>` : null}
          <div class="mobile-navigation-panel">${this.appShell.isMobileNavigationLayout ? this.renderNavigationPanel(true) : null}</div>
          ${
					state.selectedSession
						? html`
            <chat-view .sessionId=${state.selectedSession.id} .messages=${state.messages} .messageStart=${state.messagePageStart} .messageEnd=${state.messagePageEnd} .messageTotal=${state.messagePageTotal} .hasMore=${state.messagePageStart > 0} .loadingMore=${state.isLoadingEarlierMessages} .isReceivingPartialStream=${state.isReceivingPartialStream} .isCompacting=${state.status?.isCompacting === true} .pendingMessageCount=${state.status?.pendingMessageCount ?? 0} .status=${state.status} .activity=${state.activity} .onLoadMore=${() => this.withChatPrependTransition(() => this.sessions.loadEarlierMessages())}></chat-view>
            <prompt-editor .sessionId=${state.selectedSession.id} .cwd=${state.selectedWorkspace?.path} .disabled=${false} .canSteer=${state.status?.isStreaming === true} .isCompacting=${state.status?.isCompacting === true} .canStop=${state.status?.isStreaming === true || state.status?.isBashRunning === true || state.status?.isCompacting === true || (state.status?.pendingMessageCount ?? 0) > 0} .status=${state.status} .onSend=${(
					text: string,
					streamingBehavior?: "steer" | "followUp",
				) => {
					this.sendPrompt(text, streamingBehavior);
				}} .onStop=${() => this.sessions.stopActiveWork()} .onSelectModel=${() => {
					void this.openModelDialog();
				}} .onSelectThinking=${() => {
					void this.openThinkingDialog();
				}}></prompt-editor>
            <status-bar .status=${state.status} .workspace=${state.selectedWorkspace} .workspaceLabelItems=${state.selectedWorkspace === undefined ? [] : this.plugins.getWorkspaceLabelItems(state, state.selectedWorkspace)}></status-bar>
            ${
					state.commandDialog !== undefined
						? html`<command-picker .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog?.requestId ?? "", value)} .onCancel=${() => {
								this.sessions.cancelCommand();
							}}></command-picker>`
						: null
				}
            ${
					state.modelDialog !== undefined
						? html`<command-picker title=${state.modelDialog.title} .searchable=${true} .options=${state.modelDialog.options} .selectedValue=${state.modelDialog.selectedValue} .onPick=${(
								value: string,
							) => {
								void this.pickModel(value);
							}} .onCancel=${() => {
								this.setState({ modelDialog: undefined });
							}}></command-picker>`
						: null
				}
            ${
					state.thinkingDialog !== undefined
						? html`<command-picker title=${state.thinkingDialog.title} .options=${state.thinkingDialog.options} .selectedValue=${state.thinkingDialog.selectedValue} .onPick=${(
								value: string,
							) => {
								void this.pickThinking(value);
							}} .onCancel=${() => {
								this.setState({ thinkingDialog: undefined });
							}}></command-picker>`
						: null
				}
            ${
					state.authDialog !== undefined
						? html`<auth-dialog .state=${state.authDialog} .onChooseMethod=${(authType: "oauth" | "api_key") => {
								void this.auth.chooseLoginMethod(authType);
							}} .onSelectProvider=${(providerId: string, authType: "oauth" | "api_key") => {
								void this.auth.selectLoginProvider(providerId, authType);
							}} .onApiKeyInput=${(value: string) => {
								this.auth.updateApiKey(value);
							}} .onSaveApiKey=${() => {
								void this.auth.saveApiKey();
							}} .onLogoutProvider=${(providerId: string) => {
								void this.auth.logoutProvider(providerId);
							}} .onOAuthInput=${(value: string) => {
								this.auth.updateOAuthInput(value);
							}} .onOAuthRespond=${(value?: string) => {
								void this.auth.respondOAuth(value);
							}} .onOAuthCancel=${() => {
								void this.auth.cancelOAuth();
							}} .onCancel=${() => {
								this.auth.closeDialog();
							}}></auth-dialog>`
						: null
				}
          `
						: html`<div class="empty">${this.sessionEmptyMessage()}</div>`
				}
        </main>
        ${this.renderWorkspacePanelEdgeControl()}
        ${this.renderWorkspacePanel()}
        ${
				state.actionPaletteOpen
					? html`<action-palette .actions=${this.getActions()} .onRun=${(action: AppAction) => {
							this.setState({ actionPaletteOpen: false });
							this.runAction(action);
						}} .onCancel=${() => {
							this.setState({ actionPaletteOpen: false });
						}}></action-palette>`
					: null
			}
        ${
				state.projectDialogOpen
					? html`<project-dialog .onSubmit=${(path: string, create: boolean) => this.projects.addProject(path, create)} .onCancel=${() => {
							this.setState({ projectDialogOpen: false });
						}}></project-dialog>`
					: null
			}
        ${
				state.themeDialog !== undefined
					? html`<command-picker title=${state.themeDialog.title} .options=${state.themeDialog.options} .selectedValue=${state.themeDialog.selectedValue} .onPick=${(
							value: string,
						) => {
							this.pickTheme(value);
						}} .onCancel=${() => {
							this.setState({ themeDialog: undefined });
						}}></command-picker>`
					: null
			}
      </div>
    `;
	}

	static override styles = appStyles;
}

function patchChangesState(state: AppState, patch: Partial<AppState>): boolean {
	return Object.entries(patch).some(([key, value]) => Reflect.get(state, key) !== value);
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) =>
		requestAnimationFrame(() => {
			resolve();
		}),
	);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	return (
		value === "off" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	);
}

function thinkingDescription(level: ThinkingLevel): string {
	switch (level) {
		case "off":
			return "No reasoning";
		case "minimal":
			return "Very brief reasoning (~1k tokens)";
		case "low":
			return "Light reasoning (~2k tokens)";
		case "medium":
			return "Moderate reasoning (~8k tokens)";
		case "high":
			return "Deep reasoning (~16k tokens)";
		case "xhigh":
			return "Maximum reasoning (~32k tokens)";
	}
}
