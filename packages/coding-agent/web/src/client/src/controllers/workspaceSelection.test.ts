import { describe, expect, it } from "vitest";
import type { Workspace } from "../api";
import { InMemoryWorkspaceSelectionMemory, selectPreferredWorkspace } from "./workspaceSelection";

describe("selectPreferredWorkspace", () => {
	it("prefers an explicit target workspace", () => {
		const workspaces = [testWorkspace("main"), testWorkspace("feature")];

		expect(
			selectPreferredWorkspace(workspaces, { targetWorkspaceId: "feature", latestWorkspaceId: "main" })?.id,
		).toBe("feature");
	});

	it("remembers the latest selected workspace when no explicit target is provided", () => {
		const workspaces = [testWorkspace("main"), testWorkspace("feature")];

		expect(selectPreferredWorkspace(workspaces, { latestWorkspaceId: "feature" })?.id).toBe("feature");
	});

	it("falls back to the first workspace when the remembered workspace no longer exists", () => {
		const workspaces = [testWorkspace("main"), testWorkspace("feature")];

		expect(selectPreferredWorkspace(workspaces, { latestWorkspaceId: "old" })?.id).toBe("main");
	});

	it("preserves explicit invalid target behavior", () => {
		const workspaces = [testWorkspace("main"), testWorkspace("feature")];

		expect(
			selectPreferredWorkspace(workspaces, { targetWorkspaceId: "old", latestWorkspaceId: "feature" }),
		).toBeUndefined();
	});
});

describe("InMemoryWorkspaceSelectionMemory", () => {
	it("remembers and forgets the latest selected workspace per project", () => {
		const memory = new InMemoryWorkspaceSelectionMemory();

		memory.rememberWorkspace({ ...testWorkspace("feature"), projectId: "p1" });
		memory.rememberWorkspace({ ...testWorkspace("other"), projectId: "p2" });

		expect(memory.latestWorkspaceId("p1")).toBe("feature");
		expect(memory.latestWorkspaceId("p2")).toBe("other");

		memory.forgetProject("p1");

		expect(memory.latestWorkspaceId("p1")).toBeUndefined();
		expect(memory.latestWorkspaceId("p2")).toBe("other");
	});
});

function testWorkspace(id: string): Workspace {
	return {
		id,
		projectId: "project",
		path: `/tmp/project/${id}`,
		label: id,
		isMain: id === "main",
		isGitRepo: true,
		isGitWorktree: id !== "main",
	};
}
