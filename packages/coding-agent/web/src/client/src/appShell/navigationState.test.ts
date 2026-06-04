import { describe, expect, it } from "vitest";
import {
	defaultNavigationSection,
	expandedNavigationSection,
	isNavigationSectionCollapsed,
	toggleNavigationSection,
} from "./navigationState";

describe("navigationState", () => {
	it("defaults to the first incomplete selection section", () => {
		expect(defaultNavigationSection({ selectedProject: undefined, selectedWorkspace: undefined })).toBe("projects");
		expect(defaultNavigationSection({ selectedProject: {}, selectedWorkspace: undefined })).toBe("workspaces");
		expect(defaultNavigationSection({ selectedProject: {}, selectedWorkspace: {} })).toBe("sessions");
	});

	it("expands the default section until the user explicitly toggles a section", () => {
		const state = { selectedProject: {}, selectedWorkspace: undefined };

		expect(expandedNavigationSection(undefined, state)).toBe("workspaces");
		expect(expandedNavigationSection("sessions", state)).toBe("sessions");
		expect(expandedNavigationSection("none", state)).toBeUndefined();
	});

	it("only collapses sections in mobile navigation layouts", () => {
		const state = { selectedProject: {}, selectedWorkspace: {} };

		expect(isNavigationSectionCollapsed("projects", { isMobileLayout: false, expanded: "sessions", state })).toBe(
			false,
		);
		expect(isNavigationSectionCollapsed("projects", { isMobileLayout: true, expanded: "sessions", state })).toBe(
			true,
		);
		expect(isNavigationSectionCollapsed("sessions", { isMobileLayout: true, expanded: "sessions", state })).toBe(
			false,
		);
	});

	it("toggles the effective section, including the implicit default section", () => {
		const state = { selectedProject: undefined, selectedWorkspace: undefined };

		expect(toggleNavigationSection(undefined, "projects", { isMobileLayout: true, state })).toBe("none");
		expect(toggleNavigationSection("none", "projects", { isMobileLayout: true, state })).toBe("projects");
		expect(toggleNavigationSection("projects", "workspaces", { isMobileLayout: true, state })).toBe("workspaces");
	});

	it("does not mutate expanded section on desktop layouts", () => {
		const state = { selectedProject: undefined, selectedWorkspace: undefined };

		expect(toggleNavigationSection("projects", "projects", { isMobileLayout: false, state })).toBe("projects");
	});
});
