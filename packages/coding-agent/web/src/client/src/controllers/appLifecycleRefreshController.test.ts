import { describe, expect, it, vi } from "vitest";
import { AppLifecycleRefreshController } from "./appLifecycleRefreshController";

describe("AppLifecycleRefreshController", () => {
	it("repairs viewport and refreshes background data on focus", async () => {
		const { controller, deps } = createController();

		controller.handleFocus();
		await Promise.resolve();

		expect(deps.repairViewportPosition).toHaveBeenCalledOnce();
		expect(deps.refreshSelectedSession).toHaveBeenCalledOnce();
		expect(deps.refreshPiWebStatus).toHaveBeenCalledOnce();
		expect(deps.refreshWorkspaceActivity).toHaveBeenCalledOnce();
		expect(deps.refreshWorkspaceDeletionRuns).toHaveBeenCalledOnce();
	});

	it("only refreshes on visible visibility state", () => {
		const { controller, deps } = createController();

		controller.handleVisibilityChange("hidden");
		expect(deps.repairViewportPosition).not.toHaveBeenCalled();

		controller.handleVisibilityChange("visible");
		expect(deps.repairViewportPosition).toHaveBeenCalledOnce();
		expect(deps.refreshSelectedSession).toHaveBeenCalledOnce();
	});

	it("deduplicates manual app refresh", async () => {
		let resolveRefresh: (() => void) | undefined;
		const refreshWorkspaceSurface = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveRefresh = resolve;
				}),
		);
		const { controller, deps, state } = createController({
			refreshWorkspaceSurface,
		});

		const first = controller.refreshAppData();
		const second = controller.refreshAppData();
		expect(state.refreshing).toBe(true);
		resolveRefresh?.();
		await Promise.all([first, second]);

		expect(deps.refreshSelectedSession).toHaveBeenCalledOnce();
		expect(deps.refreshWorkspaceSurface).toHaveBeenCalledOnce();
		expect(state.refreshing).toBe(false);
	});

	it("logs workspace activity refresh failures", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { controller } = createController({ refreshWorkspaceActivity: vi.fn(() => Promise.reject(new Error("boom"))) });

		await controller.refreshWorkspaceActivity();

		expect(warn).toHaveBeenCalledWith("Failed to refresh workspace activity", expect.any(Error));
		warn.mockRestore();
	});
});

function createController(overrides: Partial<ReturnType<typeof dependencies>> = {}) {
	const state = { refreshing: false };
	const deps = { ...dependencies(), ...overrides };
	const controller = new AppLifecycleRefreshController({
		...deps,
		isRefreshing: () => state.refreshing,
		setRefreshing: (refreshing) => {
			state.refreshing = refreshing;
		},
	});
	return { controller, deps, state };
}

function dependencies() {
	return {
		repairViewportPosition: vi.fn(),
		refreshSelectedSession: vi.fn(() => Promise.resolve()),
		refreshPiWebStatus: vi.fn(() => Promise.resolve()),
		refreshWorkspaceActivity: vi.fn(() => Promise.resolve()),
		refreshWorkspaceDeletionRuns: vi.fn(() => Promise.resolve()),
		refreshWorkspaceSurface: vi.fn(() => Promise.resolve()),
	};
}
