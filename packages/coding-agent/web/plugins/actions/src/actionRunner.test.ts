import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@earendil-works/pi-coding-agent/web-plugin-api";
import { runWorkspaceActionInTerminal } from "./actionRunner";
import type { WorkspaceAction } from "./config";
import type { InternalTerminalCommandRun, InternalTerminalCommandRunsRuntime } from "./piWebInternal";

const workspace: Workspace = {
  id: "workspace 1",
  projectId: "project/1",
  path: "/repo",
  label: "repo",
  isMain: false,
  isGitRepo: true,
  isGitWorktree: true,
};

const run: InternalTerminalCommandRun = {
  id: "run1",
  origin: "actions",
  projectId: workspace.projectId,
  workspaceId: workspace.id,
  terminalId: "term1",
  title: "Build",
  command: "npm run build",
  status: "running",
  createdAt: "2026-05-25T00:00:00.000Z",
  metadata: { "pi.plugin": "actions", "action.id": "build" },
};

describe("action runner", () => {
  it("starts workspace actions through the internal terminal command-run helper", async () => {
    const action: WorkspaceAction = { id: "build", title: "Build", command: "npm run build", confirm: false };
    const runCommand = vi.fn<InternalTerminalCommandRunsRuntime["runCommand"]>(() => Promise.resolve({ run, completed: Promise.resolve(run) }));
    const terminal: InternalTerminalCommandRunsRuntime = {
      runCommand,
      open: vi.fn(),
    };

    const handle = await runWorkspaceActionInTerminal(terminal, workspace, action);

    expect(handle.run).toEqual(run);
    await expect(handle.completed).resolves.toEqual(run);
    expect(runCommand).toHaveBeenCalledWith({
      workspace,
      title: "Build",
      command: "npm run build",
      open: true,
      metadata: { "pi.plugin": "actions", "action.id": "build" },
    });
  });
});
