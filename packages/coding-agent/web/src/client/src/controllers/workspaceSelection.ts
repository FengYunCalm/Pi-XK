import type { Workspace } from "../api";

export interface WorkspaceSelectionMemory {
	latestWorkspaceId(projectId: string): string | undefined;
	rememberWorkspace(workspace: Workspace): void;
	forgetProject(projectId: string): void;
}

export class InMemoryWorkspaceSelectionMemory implements WorkspaceSelectionMemory {
	private readonly workspaceIdsByProject = new Map<string, string>();

	latestWorkspaceId(projectId: string): string | undefined {
		return this.workspaceIdsByProject.get(projectId);
	}

	rememberWorkspace(workspace: Workspace): void {
		this.workspaceIdsByProject.set(workspace.projectId, workspace.id);
	}

	forgetProject(projectId: string): void {
		this.workspaceIdsByProject.delete(projectId);
	}
}

export function selectPreferredWorkspace(
	workspaces: Workspace[],
	options?: { targetWorkspaceId?: string | undefined; latestWorkspaceId?: string | undefined },
): Workspace | undefined {
	const targetWorkspaceId = options?.targetWorkspaceId;
	if (targetWorkspaceId !== undefined && targetWorkspaceId !== "")
		return workspaces.find((workspace) => workspace.id === targetWorkspaceId);

	const latestWorkspaceId = options?.latestWorkspaceId;
	if (latestWorkspaceId !== undefined && latestWorkspaceId !== "")
		return workspaces.find((workspace) => workspace.id === latestWorkspaceId) ?? workspaces[0];

	return workspaces[0];
}
