import { describe, expect, it } from "vitest";
import { browserOpenCommand, parseForegroundOptions, webInterfaceUrl, webInterfaceUrlWithToken } from "./cli.ts";

describe("Pi Web CLI", () => {
	it("parses foreground options with silent logs by default", () => {
		expect(parseForegroundOptions([])).toEqual({ host: "127.0.0.1", port: "8504", printLogs: false });
	});

	it("parses host, port, config, and print-log options", () => {
		expect(parseForegroundOptions(["--host", "0.0.0.0", "--port=9000", "--config", "./web.json", "--print-logs"])).toEqual({
			host: "0.0.0.0",
			port: "9000",
			config: "./web.json",
			printLogs: true,
		});
	});

	it("formats a browser-safe local URL", () => {
		expect(webInterfaceUrl({ host: "0.0.0.0", port: "8504" })).toBe("http://127.0.0.1:8504/");
		expect(webInterfaceUrl({ host: "::1", port: "8504" })).toBe("http://[::1]:8504/");
	});

	it("adds an access token to the browser URL when needed", () => {
		expect(webInterfaceUrlWithToken({ host: "0.0.0.0", port: "8504" }, "secret")).toBe(
			"http://127.0.0.1:8504/?token=secret",
		);
	});

	it("selects platform browser opener commands", () => {
		expect(browserOpenCommand("http://127.0.0.1:8504/", "darwin")).toEqual({
			command: "open",
			args: ["http://127.0.0.1:8504/"],
		});
		expect(browserOpenCommand("http://127.0.0.1:8504/", "win32")).toEqual({
			command: "cmd",
			args: ["/c", "start", "", "http://127.0.0.1:8504/"],
		});
		expect(browserOpenCommand("http://127.0.0.1:8504/", "linux", {})).toEqual({
			command: "xdg-open",
			args: ["http://127.0.0.1:8504/"],
		});
	});

	it("uses the Windows opener from WSL", () => {
		expect(browserOpenCommand("http://127.0.0.1:8504/", "linux", { WSL_DISTRO_NAME: "Ubuntu" })).toEqual({
			command: "cmd.exe",
			args: ["/c", "start", "", "http://127.0.0.1:8504/"],
		});
	});
});
