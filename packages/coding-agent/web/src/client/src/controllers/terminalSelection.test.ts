import { describe, expect, it } from "vitest";
import type { TerminalInfo } from "../api";
import { InMemoryTerminalSelectionMemory, selectFallbackTerminal, selectPreferredTerminal } from "./terminalSelection";

function terminal(id: string, exited = false): TerminalInfo {
	return { id, cwd: "/repo", name: id, createdAt: "now", exited };
}

describe("terminal selection", () => {
	it("prefers explicit route targets before remembered or default terminals", () => {
		const terminals = [terminal("first"), terminal("target")];

		expect(selectPreferredTerminal(terminals, { targetTerminalId: "target", latestTerminalId: "first" })?.id).toBe(
			"target",
		);
	});

	it("uses remembered terminals when there is no route target", () => {
		const terminals = [terminal("first"), terminal("remembered")];

		expect(selectPreferredTerminal(terminals, { latestTerminalId: "remembered" })?.id).toBe("remembered");
	});

	it("falls back to an active terminal and then any terminal", () => {
		expect(selectPreferredTerminal([terminal("exited", true), terminal("active")])?.id).toBe("active");
		expect(selectFallbackTerminal([terminal("exited", true)])?.id).toBe("exited");
	});

	it("remembers terminal ids per workspace cwd", () => {
		const memory = new InMemoryTerminalSelectionMemory();
		memory.rememberTerminal("/repo", "t1");
		memory.rememberTerminal("/other", "t2");

		expect(memory.latestTerminalId("/repo")).toBe("t1");
		memory.forgetTerminal("t1");
		expect(memory.latestTerminalId("/repo")).toBeUndefined();
		expect(memory.latestTerminalId("/other")).toBe("t2");
	});
});
