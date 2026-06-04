export interface AppLifecycleRefreshControllerDependencies {
	isRefreshing: () => boolean;
	setRefreshing: (refreshing: boolean) => void;
	repairViewportPosition: () => void;
	refreshSelectedSession: () => Promise<void>;
	refreshPiWebStatus: () => Promise<void>;
	refreshWorkspaceActivity: () => Promise<void>;
	refreshWorkspaceDeletionRuns: () => Promise<void>;
	refreshWorkspaceSurface: () => Promise<void>;
}

export class AppLifecycleRefreshController {
	private readonly isRefreshing: AppLifecycleRefreshControllerDependencies["isRefreshing"];
	private readonly setRefreshing: AppLifecycleRefreshControllerDependencies["setRefreshing"];
	private readonly repairViewportPosition: AppLifecycleRefreshControllerDependencies["repairViewportPosition"];
	private readonly refreshSelectedSession: AppLifecycleRefreshControllerDependencies["refreshSelectedSession"];
	private readonly refreshPiWebStatus: AppLifecycleRefreshControllerDependencies["refreshPiWebStatus"];
	private readonly refreshActivity: AppLifecycleRefreshControllerDependencies["refreshWorkspaceActivity"];
	private readonly refreshWorkspaceDeletionRuns: AppLifecycleRefreshControllerDependencies["refreshWorkspaceDeletionRuns"];
	private readonly refreshWorkspaceSurface: AppLifecycleRefreshControllerDependencies["refreshWorkspaceSurface"];

	constructor(deps: AppLifecycleRefreshControllerDependencies) {
		this.isRefreshing = deps.isRefreshing;
		this.setRefreshing = deps.setRefreshing;
		this.repairViewportPosition = deps.repairViewportPosition;
		this.refreshSelectedSession = deps.refreshSelectedSession;
		this.refreshPiWebStatus = deps.refreshPiWebStatus;
		this.refreshActivity = deps.refreshWorkspaceActivity;
		this.refreshWorkspaceDeletionRuns = deps.refreshWorkspaceDeletionRuns;
		this.refreshWorkspaceSurface = deps.refreshWorkspaceSurface;
	}

	handlePageShow(): void {
		this.repairViewportPosition();
	}

	handleFocus(): void {
		this.repairViewportPosition();
		this.refreshBackgroundData();
	}

	handleVisibilityChange(visibilityState: DocumentVisibilityState): void {
		if (visibilityState !== "visible") return;
		this.repairViewportPosition();
		this.refreshBackgroundData();
	}

	refreshBackgroundData(): void {
		void this.refreshSelectedSession();
		void this.refreshPiWebStatus();
		void this.refreshWorkspaceActivity();
		void this.refreshWorkspaceDeletionRuns();
	}

	async refreshAppData(): Promise<void> {
		if (this.isRefreshing()) return;
		this.setRefreshing(true);
		try {
			await Promise.all([
				this.refreshSelectedSession(),
				this.refreshPiWebStatus(),
				this.refreshWorkspaceActivity(),
				this.refreshWorkspaceDeletionRuns(),
				this.refreshWorkspaceSurface(),
			]);
		} finally {
			this.setRefreshing(false);
		}
	}

	async refreshWorkspaceActivity(): Promise<void> {
		try {
			await this.refreshActivity();
		} catch (error) {
			console.warn("Failed to refresh workspace activity", error);
		}
	}
}
