import { describe, expect, it, vi } from "vitest";
import type { PiWebStatusResponse } from "../api";
import { PiWebStatusController } from "./piWebStatusController";

describe("PiWebStatusController", () => {
	it("refreshes status into app state", async () => {
		const patches: unknown[] = [];
		const status = fakeStatus();
		const controller = new PiWebStatusController((patch) => {
			patches.push(patch);
		}, { api: { piWebStatus: () => Promise.resolve(status) } });

		await controller.refresh();

		expect(patches).toEqual([{ piWebStatus: status }]);
	});

	it("polls until disposed", async () => {
		vi.useFakeTimers();
		try {
			const piWebStatus = vi.fn(() => Promise.resolve(fakeStatus()));
			const controller = new PiWebStatusController(() => undefined, {
				api: { piWebStatus },
				intervalMs: 50,
			});

			controller.startPolling();
			await vi.advanceTimersByTimeAsync(50);
			expect(piWebStatus).toHaveBeenCalledTimes(1);

			controller.dispose();
			await vi.advanceTimersByTimeAsync(50);
			expect(piWebStatus).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

function fakeStatus(): PiWebStatusResponse {
	return {
		packageName: "pi-web-mode-internal",
		generatedAt: "2026-01-01T00:00:00.000Z",
		components: {
			web: { component: "web", label: "Web", runtimeVersion: "0.0.0", stale: false, available: true },
			sessiond: { component: "sessiond", label: "Session daemon", runtimeVersion: "0.0.0", stale: false, available: true },
		},
		release: { packageName: "pi-web-mode-internal", updateAvailable: false, skipped: true },
		commands: {},
		messages: [],
	};
}
