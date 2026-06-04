import { describe, expect, it } from "vitest";
import type { TerminalInfo, Workspace } from "../api";
import { type AppState, initialAppState } from "../appState";
import { TerminalActivityController } from "./terminalActivityController";

const workspace: Workspace = {
	id: "w1",
	projectId: "p1",
	path: "/repo",
	label: "main",
	isMain: true,
	isGitRepo: true,
	isGitWorktree: false,
};

describe("TerminalActivityController", () => {
	it("remembers the selected terminal per workspace", () => {
		const { controller, state } = createController({ selectedWorkspace: workspace });

		controller.rememberSelectedTerminal("t-latest");

		expect(controller.resetForWorkspace(workspace, undefined)).toBe("t-latest");
		expect(state.current.selectedTerminalId).toBe("t-latest");
	});

	it("applies terminal realtime events and clears closed selections", () => {
		const { controller, state } = createController({ selectedWorkspace: workspace, selectedTerminalId: "t1" });

		expect(controller.applyTerminalEvent({ type: "terminal.created", terminal: terminal("t1") })).toEqual({
			clearedSelectedTerminal: false,
		});
		expect(state.current.activeTerminalCount).toBe(1);

		expect(controller.applyTerminalEvent({ type: "terminal.closed", terminalId: "t1", cwd: workspace.path })).toEqual({
			clearedSelectedTerminal: true,
		});
		expect(state.current.selectedTerminalId).toBeUndefined();
		expect(state.current.activeTerminalCount).toBe(0);
	});

	it("refreshes active terminal count for the selected workspace", async () => {
		const { controller, state } = createController(
			{ selectedWorkspace: workspace },
			{ terminals: () => Promise.resolve([terminal("active"), { ...terminal("done"), exited: true }]) },
		);

		await controller.refreshActiveTerminals(workspace);

		expect(state.current.activeTerminalCount).toBe(1);
	});
});

function createController(
	initial: Partial<AppState>,
	api: { terminals: (projectId: string, workspaceId: string) => Promise<TerminalInfo[]> } = { terminals: () => Promise.resolve([]) },
) {
	const state = { current: { ...initialAppState(), ...initial } };
	const controller = new TerminalActivityController(
		() => state.current,
		(patch) => {
			state.current = { ...state.current, ...patch };
		},
		{ api },
	);
	return { controller, state };
}

function terminal(id: string): TerminalInfo {
	return {
		id,
		cwd: workspace.path,
		name: id,
		createdAt: "2026-01-01T00:00:00.000Z",
		exited: false,
	};
}
