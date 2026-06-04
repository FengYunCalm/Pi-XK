import { describe, expect, it, vi } from "vitest";
import type { TerminalCommandRunsInternalRuntime } from "../plugins/types";
import { TerminalCommandRunRegistry } from "./terminalCommandRunRegistry";

describe("TerminalCommandRunRegistry", () => {
	it("caches command-run runtimes by origin", () => {
		const createRuntime = vi.fn((origin: string) => fakeRuntime(origin));
		const registry = new TerminalCommandRunRegistry({ openTerminal: () => undefined, createRuntime });

		expect(registry.forOrigin("core")).toBe(registry.forOrigin("core"));
		expect(registry.forOrigin("other")).not.toBe(registry.forOrigin("core"));
		expect(createRuntime).toHaveBeenCalledTimes(2);
	});

	it("passes terminal open requests through the shared host callback", () => {
		const openTerminal = vi.fn();
		const registry = new TerminalCommandRunRegistry({
			openTerminal,
			createRuntime: (_origin, deps) =>
				fakeRuntime("core", () => {
					deps.openTerminal(undefined, { terminalId: "t1" });
				}),
		});

		registry.forOrigin("core").open({ terminalId: "t1" });

		expect(openTerminal).toHaveBeenCalledWith(undefined, { terminalId: "t1" });
	});
});

function fakeRuntime(origin: string, open?: () => void): TerminalCommandRunsInternalRuntime {
	return {
		runCommand: () => Promise.reject(new Error(`not implemented: ${origin}`)),
		listCommandRuns: () => Promise.resolve([]),
		getCommandRun: () => Promise.resolve(undefined),
		open: () => {
			open?.();
		},
	};
}
