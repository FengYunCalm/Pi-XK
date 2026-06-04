import { describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo, Workspace } from "../api";
import { type AppState, initialAppState } from "../appState";
import type { AppRoute } from "../route";
import { RouteRestoreController } from "./routeRestoreController";

describe("RouteRestoreController", () => {
	it("restores tool state when the route already matches the current selection", async () => {
		const { controller, deps, state } = createController({
			state: {
				selectedProject: project(),
				selectedWorkspace: workspace(),
				selectedSession: session(),
			},
			route: { projectId: "p1", workspaceId: "w1", sessionId: "s1", tool: "core:workspace.git", view: "core:workspace.git" },
			namespaced: { "core.workspace.files:file": "src/app.ts", "core.workspace.terminal:terminal": "t1" },
		});

		await controller.restore(false);

		expect(state.current.workspaceTool).toBe("core:workspace.git");
		expect(state.current.mainView).toBe("core:workspace.git");
		expect(state.current.selectedFilePath).toBe("src/app.ts");
		expect(state.current.selectedTerminalId).toBe("t1");
		expect(deps.rememberSelectedTerminal).toHaveBeenCalledWith("t1");
		expect(deps.refreshRestoredTool).toHaveBeenCalledWith("core:workspace.git", "src/app.ts");
		expect(deps.updateGitPolling).toHaveBeenCalledOnce();
		expect(deps.selectProject).not.toHaveBeenCalled();
	});

	it("selects the routed project before restoring tool state", async () => {
		const { controller, deps, state } = createController({
			state: { projects: [project()] },
			route: { projectId: "p1", workspaceId: "w1", sessionId: "s1", tool: "core:workspace.files", view: "chat" },
			namespaced: { "core.workspace.files:file": "README.md" },
		});

		await controller.restore(true);

		expect(deps.selectProject).toHaveBeenCalledWith(project(), {
			workspaceId: "w1",
			sessionId: "s1",
			updateUrl: true,
		});
		expect(state.current.selectedFilePath).toBe("README.md");
		expect(deps.refreshRestoredTool).toHaveBeenCalledWith("core:workspace.files", "README.md");
		expect(deps.updateGitPolling).toHaveBeenCalledOnce();
	});

	it("exposes restored terminal id while project selection is running", async () => {
		let controller: RouteRestoreController | undefined;
		const selectProject = vi.fn(() => {
			expect(controller?.isRestoring).toBe(true);
			expect(controller?.restoringTerminalId).toBe("t1");
			return Promise.resolve();
		});
		const created = createController({
			state: { projects: [project()] },
			route: { projectId: "p1", workspaceId: "w1", sessionId: undefined, tool: undefined, view: undefined },
			namespaced: { "core.workspace.terminal:terminal": "t1" },
			selectProject,
		});
		controller = created.controller;

		await controller.restore(false);

		expect(controller?.isRestoring).toBe(false);
		expect(controller?.restoringTerminalId).toBeUndefined();
	});
});

function createController(options: {
	state?: Partial<AppState>;
	route: AppRoute;
	namespaced?: Record<string, string>;
	selectProject?: (project: Project, target: { workspaceId?: string; sessionId?: string; updateUrl?: boolean }) => Promise<void>;
}) {
	const state = { current: { ...initialAppState(), ...options.state } };
	const deps = {
		defaultRouteView: vi.fn(() => "chat" as const),
		selectProject: vi.fn(options.selectProject ?? (() => Promise.resolve())),
		rememberSelectedTerminal: vi.fn(),
		refreshRestoredTool: vi.fn(() => Promise.resolve()),
		updateGitPolling: vi.fn(),
	};
	const controller = new RouteRestoreController(
		() => state.current,
		(patch: Partial<AppState>) => {
			state.current = { ...state.current, ...patch };
		},
		{
			...deps,
			readRoute: () => options.route,
			readNamespacedString: (namespace, key) => options.namespaced?.[`${namespace}:${key}`],
		},
	);
	return { controller, deps, state };
}

function project(): Project {
	return {
		id: "p1",
		name: "Project",
		path: "/repo",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}

function workspace(): Workspace {
	return {
		id: "w1",
		projectId: "p1",
		path: "/repo",
		label: "workspace",
		isMain: true,
		isGitRepo: true,
		isGitWorktree: false,
	};
}

function session(): SessionInfo {
	return {
		id: "s1",
		path: "/sessions/s1",
		cwd: "/repo",
		created: "2026-01-01T00:00:00.000Z",
		modified: "2026-01-01T00:00:00.000Z",
		messageCount: 1,
		firstMessage: "hello",
	};
}
