import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSocket } from "./sessionSocket";

class FakeWebSocket {
	static readonly CONNECTING = 0;
	readonly url: string;
	readyState = 1;
	onopen: (() => void) | null = null;
	onmessage: ((message: { data: MessageEvent["data"] }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;

	constructor(url: string) {
		this.url = url;
	}

	close(): void {
		this.readyState = 3;
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("SessionSocket", () => {
	it("drops messages from stale connections after async parsing", async () => {
		const sockets: FakeWebSocket[] = [];
		vi.stubGlobal("window", {
			location: { href: "http://127.0.0.1:8504/", origin: "http://127.0.0.1:8504", search: "" },
			sessionStorage: createStorage(),
			clearTimeout: globalThis.clearTimeout,
			setTimeout: globalThis.setTimeout,
		});
		vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:8504" });
		vi.stubGlobal(
			"WebSocket",
			class extends FakeWebSocket {
				constructor(url: string) {
					super(url);
					sockets.push(this);
				}
			},
		);
		const oldHandler = vi.fn();
		const newHandler = vi.fn();
		const socket = new SessionSocket();

		socket.connect("old", oldHandler);
		sockets[0]?.onmessage?.({ data: new Blob([JSON.stringify({ type: "message.append" })]) });
		socket.connect("new", newHandler);
		await Promise.resolve();
		await Promise.resolve();

		expect(oldHandler).not.toHaveBeenCalled();
		expect(newHandler).not.toHaveBeenCalled();
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
