import { afterEach, describe, expect, it, vi } from "vitest";
import { withPiWebTokenQuery } from "./auth";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Pi Web auth URLs", () => {
	it("adds token only to same-origin URLs", () => {
		vi.stubGlobal("window", {
			location: {
				href: "http://127.0.0.1:8504/?token=secret",
				origin: "http://127.0.0.1:8504",
				search: "?token=secret",
			},
			sessionStorage: createStorage(),
		});

		expect(withPiWebTokenQuery("/api/projects")).toBe("/api/projects?token=secret");
		expect(withPiWebTokenQuery("https://example.test/plugin.js")).toBe("https://example.test/plugin.js");
	});
});

function createStorage(): Pick<Storage, "getItem" | "setItem"> {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}
