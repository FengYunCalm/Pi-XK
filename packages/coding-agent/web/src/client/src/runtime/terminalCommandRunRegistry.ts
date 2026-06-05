import type { Workspace } from "../api";
import type { TerminalCommandRunsInternalRuntime } from "../plugins/types";
import { createTerminalCommandRunsRuntime } from "./terminalRuntime";

export interface TerminalCommandRunRegistryOptions {
	openTerminal: (
		workspace: Workspace | undefined,
		options?: { terminalId?: string | undefined },
	) => void | Promise<void>;
	createRuntime?: typeof createTerminalCommandRunsRuntime;
}

export class TerminalCommandRunRegistry {
	private readonly runtimes = new Map<string, TerminalCommandRunsInternalRuntime>();
	private readonly openTerminal: TerminalCommandRunRegistryOptions["openTerminal"];
	private readonly createRuntime: typeof createTerminalCommandRunsRuntime;

	constructor(options: TerminalCommandRunRegistryOptions) {
		this.openTerminal = options.openTerminal;
		this.createRuntime = options.createRuntime ?? createTerminalCommandRunsRuntime;
	}

	forOrigin(origin: string): TerminalCommandRunsInternalRuntime {
		const existing = this.runtimes.get(origin);
		if (existing !== undefined) return existing;
		const runtime = this.createRuntime(origin, {
			openTerminal: (workspace, options) => this.openTerminal(workspace, options),
		});
		this.runtimes.set(origin, runtime);
		return runtime;
	}

	dispose(): void {
		for (const runtime of this.runtimes.values()) runtime.dispose();
		this.runtimes.clear();
	}
}
