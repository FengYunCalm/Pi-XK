import { piWebApi as defaultApi } from "../api";
import type { SetState } from "./types";

export const PI_WEB_STATUS_REFRESH_MS = 15 * 60 * 1000;

export interface PiWebStatusControllerDependencies {
	api?: Pick<typeof defaultApi, "piWebStatus">;
	intervalMs?: number;
}

export class PiWebStatusController {
	private readonly api: Pick<typeof defaultApi, "piWebStatus">;
	private readonly intervalMs: number;
	private timer: ReturnType<typeof globalThis.setInterval> | undefined;

	constructor(
		private readonly setState: SetState,
		deps: PiWebStatusControllerDependencies = {},
	) {
		this.api = deps.api ?? defaultApi;
		this.intervalMs = deps.intervalMs ?? PI_WEB_STATUS_REFRESH_MS;
	}

	startPolling(): void {
		this.stopPolling();
		this.timer = globalThis.setInterval(() => {
			void this.refresh();
		}, this.intervalMs);
	}

	stopPolling(): void {
		if (this.timer !== undefined) globalThis.clearInterval(this.timer);
		this.timer = undefined;
	}

	dispose(): void {
		this.stopPolling();
	}

	async refresh(): Promise<void> {
		try {
			this.setState({ piWebStatus: await this.api.piWebStatus() });
		} catch (error) {
			console.warn("Failed to refresh PI WEB status", error);
		}
	}
}
