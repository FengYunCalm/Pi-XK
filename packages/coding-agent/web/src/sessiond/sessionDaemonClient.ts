import http from "node:http";
import { WebSocket } from "ws";
import { sessiondHttpUrl, sessiondSocketPath } from "./config.ts";

export class SessionDaemonClient {
	private readonly baseUrl = sessiondHttpUrl();
	private readonly socketPath = sessiondSocketPath();

	async request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		if (this.baseUrl !== undefined && this.baseUrl !== "") return this.requestUrl(method, path, payload);
		return this.requestSocket(method, path, payload);
	}

	connectWebSocket(path: string): WebSocket {
		if (this.baseUrl !== undefined && this.baseUrl !== "") {
			const url = new URL(path, this.baseUrl);
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			return new WebSocket(url);
		}
		return new WebSocket(`ws+unix:${this.socketPath}:${path}`);
	}

	private async requestUrl(method: string, path: string, payload?: string) {
		const init: RequestInit = { method };
		if (payload !== undefined && payload !== "") {
			init.headers = { "content-type": "application/json" };
			init.body = payload;
		}
		const response = await fetch(new URL(path, this.baseUrl), init);
		return {
			statusCode: response.status,
			headers: Object.fromEntries(response.headers.entries()),
			body: await response.text(),
		};
	}

	private requestSocket(
		method: string,
		path: string,
		payload?: string,
	): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
		return new Promise((resolve, reject) => {
			const request = http.request(
				{
					socketPath: this.socketPath,
					path,
					method,
					headers:
						payload !== undefined && payload !== ""
							? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
							: undefined,
				},
				(response) => {
					const chunks: Uint8Array[] = [];
					response.on("data", (chunk: Buffer | string) => {
						chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
					});
					response.on("end", () => {
						resolve({
							statusCode: response.statusCode ?? 500,
							headers: Object.fromEntries(
								Object.entries(response.headers).map(([key, value]) => [
									key,
									Array.isArray(value) ? value.join(", ") : (value ?? ""),
								]),
							),
							body: Buffer.concat(chunks).toString("utf8"),
						});
					});
				},
			);
			request.on("error", reject);
			if (payload !== undefined && payload !== "") request.write(payload);
			request.end();
		});
	}
}
