import { describe, expect, it, vi } from "vitest";
import type { Project, RunTerminalCommandInput, TerminalCommandRun, Workspace } from "../api";
import { type AppState, initialAppState } from "../appState";
import type { TerminalCommandRunsInternalRuntime } from "../plugins/types";
import { workspaceDeletionMetadata } from "../workspaceDeletion";
import { WorkspaceDeletionController } from "./workspaceDeletionController";

const mainWorkspace = workspace({ id: "main", path: "/repo", isMain: true, isGitWorktree: false });
const worktree = workspace({ id: "wt1", path: "/repo-wt", isMain: false, isGitWorktree: true, branch: "feature" });

describe("WorkspaceDeletionController", () => {
	it("starts deletion through the terminal command runtime", async () => {
		const run = commandRun({ id: "run1", status: "running" });
		const runCommand = vi.fn(() => Promise.resolve({ run, completed: new Promise<TerminalCommandRun>(() => undefined) }));
		const { controller, state } = createController({ runCommand });

		await controller.deleteWorkspace(worktree);

		expect(runCommand).toHaveBeenCalledWith({
			workspace: mainWorkspace,
			title: "Delete workspace: feature",
			command: "git worktree remove '/repo-wt'",
			open: true,
			metadata: workspaceDeletionMetadata(worktree),
		});
		expect(state.current.workspaceDeletionRuns).toEqual({ wt1: run });
	});

	it("refreshes project workspaces after a successful deletion run", async () => {
		const refreshAfterWorkspaceDeleted = vi.fn(() => Promise.resolve());
		const run = commandRun({ id: "run2", status: "succeeded" });
		const { controller, state } = createController({ listCommandRuns: () => Promise.resolve([run]), refreshAfterWorkspaceDeleted });

		await controller.refreshRuns();

		expect(refreshAfterWorkspaceDeleted).toHaveBeenCalledWith("p1", "wt1");
		expect(state.current.workspaceDeletionRuns).toEqual({});
	});
});

function createController(options: {
	runCommand?: (input: RunTerminalCommandInput) => Promise<{ run: TerminalCommandRun; completed: Promise<TerminalCommandRun> }>;
	listCommandRuns?: () => Promise<TerminalCommandRun[]>;
	refreshAfterWorkspaceDeleted?: (projectId: string, workspaceId: string) => Promise<void>;
}) {
	const state = { current: { ...initialAppState(), selectedProject: project() } };
	const runtime: TerminalCommandRunsInternalRuntime = {
		runCommand: options.runCommand ?? (() => Promise.reject(new Error("unexpected runCommand"))),
		listCommandRuns: options.listCommandRuns ?? (() => Promise.resolve([])),
		getCommandRun: () => Promise.resolve(undefined),
		open: () => undefined,
	};
	const controller = new WorkspaceDeletionController(
		() => state.current,
		(patch: Partial<AppState>) => {
			state.current = { ...state.current, ...patch };
		},
		{
			terminalCommandRunsForOrigin: () => runtime,
			mainWorkspaceForProject: () => Promise.resolve(mainWorkspace),
			refreshAfterWorkspaceDeleted: options.refreshAfterWorkspaceDeleted ?? (() => Promise.resolve()),
			confirm: () => true,
			setInterval: (() => 1) as unknown as typeof globalThis.setInterval,
			clearInterval: () => undefined,
		},
	);
	return { controller, state };
}

function project(): Project {
	return {
		id: "p1",
		name: "Project",
		path: "/repo",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}

function workspace(patch: Partial<Workspace>): Workspace {
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

function commandRun(patch: Partial<TerminalCommandRun>): TerminalCommandRun {
	return {
		id: "run",
		origin: "core",
		projectId: "p1",
		workspaceId: mainWorkspace.id,
		terminalId: "t1",
		title: "Delete workspace",
		command: "git worktree remove '/repo-wt'",
		status: "running",
		createdAt: "2026-01-01T00:00:00.000Z",
		metadata: workspaceDeletionMetadata(worktree),
		...patch,
	};
}
