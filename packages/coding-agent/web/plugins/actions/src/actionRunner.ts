import type { Workspace } from "@earendil-works/pi-coding-agent/web-plugin-api";
import type { WorkspaceAction } from "./config.ts";
import type { InternalTerminalCommandRunsRuntime } from "./piWebInternal.ts";

export function runWorkspaceActionInTerminal(terminal: InternalTerminalCommandRunsRuntime, workspace: Workspace, action: WorkspaceAction): ReturnType<InternalTerminalCommandRunsRuntime["runCommand"]> {
  return terminal.runCommand({
    workspace,
    title: action.title,
    command: action.command,
    open: true,
    metadata: {
      "pi.plugin": "actions",
      "action.id": action.id,
    },
  });
}
