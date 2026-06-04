import { terminalsApi as defaultApi, type TerminalUiEvent, type Workspace } from "../api";
import { InMemoryTerminalSelectionMemory, type TerminalSelectionMemory } from "./terminalSelection";
import type { GetState, SetState } from "./types";

export interface TerminalActivityControllerDependencies {
	api?: Pick<typeof defaultApi, "terminals">;
	selection?: TerminalSelectionMemory;
}

export class TerminalActivityController {
	private readonly activeTerminalIds = new Set<string>();
	private readonly api: Pick<typeof defaultApi, "terminals">;
	private readonly selection: TerminalSelectionMemory;

	constructor(
		private readonly getState: GetState,
		private readonly setState: SetState,
		deps: TerminalActivityControllerDependencies = {},
	) {
		this.api = deps.api ?? defaultApi;
		this.selection = deps.selection ?? new InMemoryTerminalSelectionMemory();
	}

	resetForWorkspace(workspace: Workspace | undefined, restoredTerminalId: string | undefined): string | undefined {
		this.activeTerminalIds.clear();
		const selectedTerminalId = restoredTerminalId ?? (workspace === undefined ? undefined : this.selection.latestTerminalId(workspace.path));
		this.setState({ activeTerminalCount: 0, selectedTerminalId });
		return selectedTerminalId;
	}

	rememberSelectedTerminal(terminalId: string | undefined): void {
		const workspace = this.getState().selectedWorkspace;
		if (workspace === undefined) return;
		if (terminalId === undefined) this.selection.forgetWorkspace(workspace.path);
		else this.selection.rememberTerminal(workspace.path, terminalId);
	}

	applyTerminalEvent(event: TerminalUiEvent): { clearedSelectedTerminal: boolean } {
		const workspace = this.getState().selectedWorkspace;
		if (workspace === undefined) return { clearedSelectedTerminal: false };
		const cwd = event.type === "terminal.closed" ? event.cwd : event.terminal.cwd;
		if (cwd !== workspace.path) return { clearedSelectedTerminal: false };
		if (event.type === "terminal.created" && !event.terminal.exited) this.activeTerminalIds.add(event.terminal.id);
		else this.activeTerminalIds.delete(event.type === "terminal.closed" ? event.terminalId : event.terminal.id);

		let clearedSelectedTerminal = false;
		if (event.type === "terminal.closed") {
			this.selection.forgetTerminal(event.terminalId);
			if (this.getState().selectedTerminalId === event.terminalId) {
				clearedSelectedTerminal = true;
				this.setState({ selectedTerminalId: undefined });
			}
		}
		this.setState({ activeTerminalCount: this.activeTerminalIds.size });
		return { clearedSelectedTerminal };
	}

	async refreshActiveTerminals(workspace: Workspace): Promise<void> {
		try {
			const terminals = await this.api.terminals(workspace.projectId, workspace.id);
			if (this.getState().selectedWorkspace?.id !== workspace.id) return;
			this.activeTerminalIds.clear();
			for (const terminal of terminals) {
				if (!terminal.exited) this.activeTerminalIds.add(terminal.id);
			}
			this.setState({ activeTerminalCount: this.activeTerminalIds.size });
		} catch (error) {
			this.setState({ error: String(error) });
		}
	}
}
