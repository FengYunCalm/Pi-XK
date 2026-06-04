import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../api";
import { type AppState, initialAppState } from "../appState";
import { WorkspaceSurfaceController } from "./workspaceSurfaceController";

describe("WorkspaceSurfaceController", () => {
	it("opens a workspace tool and refreshes the selected surface", () => {
		const { controller, deps, state } = createController({ selectedWorkspace: workspace() });

		controller.openWorkspaceTool("core:workspace.git");

		expect(state.current.workspaceTool).toBe("core:workspace.git");
		expect(state.current.mainView).toBe("core:workspace.git");
		expect(deps.refreshGit).toHaveBeenCalledOnce();
		expect(deps.updateGitPolling).toHaveBeenCalledOnce();
		expect(deps.updateUrl).toHaveBeenCalledOnce();
	});

	it("remembers terminal auto-start only for the workspace that opened terminal tool", () => {
		const selectedWorkspace = workspace({ id: "w1" });
		const { controller } = createController({ selectedWorkspace });

		controller.openWorkspaceTool("core:workspace.terminal");

		expect(controller.shouldAutoStartTerminal("w1")).toBe(true);
		expect(controller.shouldAutoStartTerminal("w2")).toBe(false);
		controller.resetTerminalAutoStart();
		expect(controller.shouldAutoStartTerminal("w1")).toBe(false);
	});

	it("refreshes the active workspace surface", async () => {
		const { controller, deps } = createController({ selectedWorkspace: workspace(), mainView: "core:workspace.terminal" });

		await controller.refreshCurrent();

		expect(deps.refreshActiveTerminals).toHaveBeenCalledWith(workspace());
		expect(deps.refreshFiles).not.toHaveBeenCalled();
		expect(deps.refreshGit).not.toHaveBeenCalled();
	});

	it("marks file and git data stale when session activity becomes idle", () => {
		const { controller, deps, state } = createController({ workspaceTool: "core:workspace.files" });
		const active = { ...state.current, activity: { sessionId: "s1", phase: "active" as const, label: "work", at: "now" } };
		const idle = { ...state.current, activity: { sessionId: "s1", phase: "idle" as const, label: "idle", at: "later" } };

		controller.handleActivityTransition(active, idle);

		expect(state.current.fileTreeStale).toBe(true);
		expect(state.current.gitStale).toBe(true);
		expect(deps.refreshFiles).toHaveBeenCalledOnce();
	});
});

function createController(patch: Partial<AppState> = {}) {
	const state = { current: { ...initialAppState(), ...patch } };
	const deps = {
		refreshFiles: vi.fn(() => Promise.resolve()),
		restoreFile: vi.fn(() => Promise.resolve()),
		refreshGit: vi.fn(() => Promise.resolve()),
		updateGitPolling: vi.fn(),
		refreshActiveTerminals: vi.fn(() => Promise.resolve()),
		updateUrl: vi.fn(),
	};
	const controller = new WorkspaceSurfaceController(
		() => state.current,
		(patch: Partial<AppState>) => {
			state.current = { ...state.current, ...patch };
		},
		deps.updateUrl,
		deps,
	);
	return { controller, deps, state };
}

function workspace(patch: Partial<Workspace> = {}): Workspace {
	return {
		id: "w1",
		projectId: "p1",
		path: "/repo",
		label: "workspace",
		isMain: true,
		isGitRepo: true,
		isGitWorktree: false,
		...patch,
	};
}
