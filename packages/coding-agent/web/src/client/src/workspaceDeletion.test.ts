import { describe, expect, it } from "vitest";
import type { TerminalCommandRun, Workspace } from "./api";
import {
	isWorkspaceDeletionPending,
	latestWorkspaceDeletionRuns,
	pendingWorkspaceDeletionIds,
	workspaceDeleteOperation,
	workspaceDeletionMetadata,
} from "./workspaceDeletion";

const workspace: Workspace = {
	id: "w1",
	projectId: "p1",
	path: "/repo/worktree",
	label: "worktree",
	isMain: false,
	isGitRepo: true,
	isGitWorktree: true,
};

function run(
	id: string,
	workspaceId: string,
	createdAt: string,
	status: TerminalCommandRun["status"],
): TerminalCommandRun {
	return {
		id,
		origin: "core",
		projectId: "p1",
		workspaceId: "main",
		terminalId: `t-${id}`,
		title: "Delete workspace",
		command: "git worktree remove '/repo/worktree'",
		status,
		createdAt,
		metadata: {
			"pi.operation": workspaceDeleteOperation,
			"target.workspaceId": workspaceId,
			"target.workspacePath": "/repo/worktree",
		},
	};
}

describe("workspace deletion state", () => {
	it("builds command-run metadata for workspace deletion", () => {
		expect(workspaceDeletionMetadata(workspace)).toEqual({
			"pi.operation": "workspace.delete",
			"target.workspaceId": "w1",
			"target.workspacePath": "/repo/worktree",
		});
	});

	it("tracks the latest deletion run per target workspace", () => {
		expect(
			latestWorkspaceDeletionRuns([
				run("old", "w1", "2026-05-25T00:00:00.000Z", "failed"),
				run("new", "w1", "2026-05-25T00:00:01.000Z", "running"),
				run("other", "w2", "2026-05-25T00:00:00.000Z", "running"),
			]),
		).toMatchObject({
			w1: { id: "new", status: "running" },
			w2: { id: "other", status: "running" },
		});
	});

	it("reports pending workspace deletions for disabling repeated actions", () => {
		const state = { workspaceDeletionRuns: { w1: run("new", "w1", "2026-05-25T00:00:01.000Z", "running") } };

		expect(isWorkspaceDeletionPending(state, workspace)).toBe(true);
		expect(pendingWorkspaceDeletionIds(state.workspaceDeletionRuns)).toEqual(["w1"]);
	});
});
