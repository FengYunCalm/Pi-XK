import type { ReactiveControllerHost } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PanelCollapseController } from "./panelCollapseController";

describe("PanelCollapseController", () => {
	beforeEach(() => {
		installLocalStorage();
	});

	it("starts with default panel widths", () => {
		const controller = new PanelCollapseController(host());

		expect(controller.navigationPanelWidth).toBe(340);
		expect(controller.workspacePanelWidth).toBe(520);
		expect(controller.shellStyle()).toBe("--navigation-panel-width: 340px; --workspace-panel-width: 520px;");
	});

	it("resizes navigation panel from the left edge", () => {
		const fakeHost = host();
		const controller = new PanelCollapseController(fakeHost);

		controller.startResize("navigation", 100);
		controller.resize(170);

		expect(controller.navigationPanelWidth).toBe(410);
		expect(fakeHost.requestUpdate).toHaveBeenCalled();
	});

	it("resizes workspace panel from the right edge and persists the width", () => {
		const controller = new PanelCollapseController(host());

		controller.startResize("workspace", 500);
		controller.resize(460);
		controller.endResize();

		expect(controller.workspacePanelWidth).toBe(560);
		expect(globalThis.localStorage.getItem("pi-web:panel-width:workspace")).toBe("560");
	});

	it("clamps panel widths", () => {
		const controller = new PanelCollapseController(host());

		controller.startResize("navigation", 100);
		controller.resize(-500);
		controller.endResize();
		controller.startResize("workspace", 100);
		controller.resize(-1000);

		expect(controller.navigationPanelWidth).toBe(240);
		expect(controller.workspacePanelWidth).toBe(760);
	});
});

function host(): ReactiveControllerHost & { requestUpdate: ReturnType<typeof vi.fn> } {
	return {
		addController: vi.fn(),
		removeController: vi.fn(),
		requestUpdate: vi.fn(),
		updateComplete: Promise.resolve(true),
	} as unknown as ReactiveControllerHost & { requestUpdate: ReturnType<typeof vi.fn> };
}

function installLocalStorage(): void {
	const values = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => {
				values.set(key, value);
			},
			removeItem: (key: string) => {
				values.delete(key);
			},
			clear: () => {
				values.clear();
			},
		} as unknown as Storage,
	});
}
