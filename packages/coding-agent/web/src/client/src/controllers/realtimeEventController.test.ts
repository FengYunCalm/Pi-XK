import { describe, expect, it, vi } from "vitest";
import type { RealtimeEvent, TerminalInfo } from "../api";
import { RealtimeEventController } from "./realtimeEventController";

describe("RealtimeEventController", () => {
	it("applies workspace activity events", () => {
		const deps = dependencies();
		const controller = new RealtimeEventController(deps);
		const activity = { cwd: "/repo", hasSessionActivity: true, hasTerminalActivity: false, updatedAt: "now" };

		controller.handle({ type: "workspace.activity", activity });

		expect(deps.applyWorkspaceActivity).toHaveBeenCalledWith(activity);
		expect(deps.applyGlobalSessionEvent).not.toHaveBeenCalled();
	});

	it("applies terminal events and refreshes deletion runs when a terminal exits", () => {
		const deps = dependencies({ applyTerminalEvent: vi.fn(() => ({ clearedSelectedTerminal: true })) });
		const controller = new RealtimeEventController(deps);

		controller.handle({ type: "terminal.exited", terminal: terminal() });

		expect(deps.applyTerminalEvent).toHaveBeenCalledWith({ type: "terminal.exited", terminal: terminal() });
		expect(deps.onSelectedTerminalCleared).toHaveBeenCalledOnce();
		expect(deps.refreshWorkspaceDeletionRuns).toHaveBeenCalledOnce();
	});

	it("applies global session events", () => {
		const deps = dependencies();
		const controller = new RealtimeEventController(deps);
		const event: RealtimeEvent = {
			type: "session.name",
			sessionId: "s1",
			name: "Renamed",
		};

		controller.handle(event);

		expect(deps.applyGlobalSessionEvent).toHaveBeenCalledWith(event);
		expect(deps.applyWorkspaceActivity).not.toHaveBeenCalled();
	});
});

function dependencies(overrides: Partial<ConstructorParameters<typeof RealtimeEventController>[0]> = {}) {
	return {
		applyWorkspaceActivity: vi.fn(),
		applyGlobalSessionEvent: vi.fn(),
		applyTerminalEvent: vi.fn(() => ({ clearedSelectedTerminal: false })),
		onSelectedTerminalCleared: vi.fn(),
		refreshWorkspaceDeletionRuns: vi.fn(),
		...overrides,
	};
}

function terminal(): TerminalInfo {
	return {
		id: "t1",
		cwd: "/repo",
		name: "Terminal",
		createdAt: "2026-01-01T00:00:00.000Z",
		exited: true,
	};
}
