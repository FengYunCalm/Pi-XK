import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { InMemorySessionSelectionMemory, selectPreferredSession } from "./sessionSelection";

describe("selectPreferredSession", () => {
	it("prefers an explicit target session by id", () => {
		const sessions = [testSession("s1"), testSession("s2")];

		expect(selectPreferredSession(sessions, { targetSessionId: "s2", latestSessionId: "s1" })?.id).toBe("s2");
	});

	it("matches explicit target sessions by id prefix", () => {
		const session = testSession("abcdef");

		expect(selectPreferredSession([session], { targetSessionId: "abc" })).toBe(session);
	});

	it("remembers the latest selected session when no explicit target is provided", () => {
		const sessions = [testSession("s1"), testSession("s2")];

		expect(selectPreferredSession(sessions, { latestSessionId: "s2" })?.id).toBe("s2");
	});

	it("falls back to the first session when the remembered session no longer exists", () => {
		const sessions = [testSession("s1"), testSession("s2")];

		expect(selectPreferredSession(sessions, { latestSessionId: "old" })?.id).toBe("s1");
	});

	it("returns undefined for an invalid explicit target", () => {
		const sessions = [testSession("s1"), testSession("s2")];

		expect(selectPreferredSession(sessions, { targetSessionId: "old", latestSessionId: "s2" })).toBeUndefined();
	});
});

describe("InMemorySessionSelectionMemory", () => {
	it("remembers and forgets the latest selected session per cwd", () => {
		const memory = new InMemorySessionSelectionMemory();

		memory.rememberSession({ ...testSession("s1"), cwd: "/tmp/one" });
		memory.rememberSession({ ...testSession("s2"), cwd: "/tmp/two" });

		expect(memory.latestSessionId("/tmp/one")).toBe("s1");
		expect(memory.latestSessionId("/tmp/two")).toBe("s2");

		memory.forgetWorkspace("/tmp/one");

		expect(memory.latestSessionId("/tmp/one")).toBeUndefined();
		expect(memory.latestSessionId("/tmp/two")).toBe("s2");
	});
});

function testSession(id: string): SessionInfo {
	return {
		id,
		path: `/tmp/project/.pi/sessions/${id}`,
		cwd: "/tmp/project",
		created: "now",
		modified: "now",
		messageCount: 0,
		firstMessage: "",
	};
}
