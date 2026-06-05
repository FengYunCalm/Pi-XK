import {
	terminalsApi as defaultApi,
	type RunTerminalCommandInput,
	type TerminalCommandRun,
	type TerminalCommandRunFilter,
	type Workspace,
} from "../api";
import type { TerminalCommandRunsInternalRuntime } from "../plugins/types";

type TimerId = ReturnType<typeof globalThis.setTimeout>;
type SetTimer = (handler: () => void, timeout: number) => TimerId;
type ClearTimer = (id: TimerId) => void;

export interface TerminalCommandRunsRuntimeDependencies {
	api?: Pick<typeof defaultApi, "runTerminalCommand" | "listCommandRuns" | "getCommandRun">;
	openTerminal: (
		workspace: Workspace | undefined,
		options?: { terminalId?: string | undefined },
	) => void | Promise<void>;
	pollIntervalMs?: number;
	setTimeout?: SetTimer;
	clearTimeout?: ClearTimer;
}

export function createTerminalCommandRunsRuntime(
	origin: string,
	deps: TerminalCommandRunsRuntimeDependencies,
): TerminalCommandRunsInternalRuntime {
	const api = deps.api ?? defaultApi;
	const pollIntervalMs = deps.pollIntervalMs ?? 1000;
	const setTimer = deps.setTimeout ?? defaultSetTimeout();
	const clearTimer = deps.clearTimeout ?? defaultClearTimeout();
	const activeCancellations = new Set<() => void>();

	return {
		async runCommand(input: RunTerminalCommandInput) {
			const run = await api.runTerminalCommand(origin, input);
			if (input.open === true) void deps.openTerminal(input.workspace, { terminalId: run.terminalId });
			const watcher = watchCommandRunCompletion(run, api, pollIntervalMs, setTimer, clearTimer);
			const cancel = () => {
				watcher.cancel();
				activeCancellations.delete(cancel);
			};
			activeCancellations.add(cancel);
			return {
				run,
				completed: watcher.completed.finally(() => {
					activeCancellations.delete(cancel);
				}),
				cancel,
			};
		},
		listCommandRuns: (filter?: TerminalCommandRunFilter) => api.listCommandRuns(filter),
		getCommandRun: (runId: string) => api.getCommandRun(runId),
		open: (options?: { terminalId?: string | undefined }) => {
			void deps.openTerminal(undefined, options);
		},
		dispose: () => {
			for (const cancel of activeCancellations) cancel();
			activeCancellations.clear();
		},
	};
}

function watchCommandRunCompletion(
	initialRun: TerminalCommandRun,
	api: Pick<typeof defaultApi, "getCommandRun">,
	pollIntervalMs: number,
	setTimer: SetTimer,
	clearTimer: ClearTimer,
): { completed: Promise<TerminalCommandRun>; cancel: () => void } {
	if (isTerminalCommandRunFinal(initialRun)) return { completed: Promise.resolve(initialRun), cancel: () => undefined };
	let timer: TimerId | undefined;
	let settled = false;

	const completed = new Promise<TerminalCommandRun>((resolve, reject) => {
		const finish = (result: TerminalCommandRun) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimer(timer);
			resolve(result);
		};

		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimer(timer);
			reject(error instanceof Error ? error : new Error(String(error)));
		};

		const poll = () => {
			void api
				.getCommandRun(initialRun.id)
				.then((run) => {
					if (settled) return;
					if (run !== undefined && isTerminalCommandRunFinal(run)) {
						finish(run);
						return;
					}
					timer = setTimer(poll, pollIntervalMs);
				})
				.catch(fail);
		};

		timer = setTimer(poll, pollIntervalMs);
	});

	return {
		completed,
		cancel: () => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimer(timer);
		},
	};
}

function isTerminalCommandRunFinal(run: TerminalCommandRun): boolean {
	return run.status === "succeeded" || run.status === "failed";
}

function defaultSetTimeout(): SetTimer {
	return (handler, timeout) => globalThis.setTimeout(handler, timeout);
}

function defaultClearTimeout(): ClearTimer {
	return (id) => {
		globalThis.clearTimeout(id);
	};
}
