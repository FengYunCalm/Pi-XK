import { randomUUID } from "node:crypto";
import type {
	TerminalCommandRun,
	TerminalCommandRunFilter,
	TerminalCommandRunStatus,
} from "../../shared/apiTypes.ts";

export interface StartTerminalCommandRunOptions {
	origin: string;
	projectId: string;
	workspaceId: string;
	terminalId: string;
	title: string;
	command: string;
	metadata?: unknown;
}

export class TerminalCommandRunStore {
	private readonly runs = new Map<string, TerminalCommandRun>();

	start(options: StartTerminalCommandRunOptions): TerminalCommandRun {
		validateStartOptions(options);
		const createdAt = new Date().toISOString();
		const run: TerminalCommandRun = {
			id: randomUUID(),
			origin: options.origin,
			projectId: options.projectId,
			workspaceId: options.workspaceId,
			terminalId: options.terminalId,
			title: options.title,
			command: options.command,
			status: "running",
			createdAt,
			startedAt: new Date().toISOString(),
			metadata: parseMetadata(options.metadata),
		};
		this.runs.set(run.id, run);
		return copyCommandRun(run);
	}

	delete(runId: string): void {
		this.runs.delete(runId);
	}

	list(filter: TerminalCommandRunFilter = {}): TerminalCommandRun[] {
		return [...this.runs.values()].filter((run) => matchesCommandRunFilter(run, filter)).map(copyCommandRun);
	}

	get(runId: string): TerminalCommandRun | undefined {
		const run = this.runs.get(runId);
		return run === undefined ? undefined : copyCommandRun(run);
	}

	complete(runId: string | undefined, exitCode: number | undefined): void {
		if (runId === undefined) return;
		const run = this.runs.get(runId);
		if (run === undefined || isTerminalCommandRunFinal(run.status)) return;
		const completed: TerminalCommandRun = {
			...run,
			status: exitCode === 0 ? "succeeded" : "failed",
			...(exitCode === undefined ? {} : { exitCode }),
			completedAt: new Date().toISOString(),
		};
		this.runs.set(runId, completed);
	}

	isFinal(runId: string): boolean {
		const run = this.runs.get(runId);
		return run !== undefined && isTerminalCommandRunFinal(run.status);
	}
}

function validateStartOptions(options: StartTerminalCommandRunOptions): void {
	if (options.origin.trim() === "") throw new Error("origin is required");
	if (options.projectId.trim() === "") throw new Error("projectId is required");
	if (options.workspaceId.trim() === "") throw new Error("workspaceId is required");
	if (options.terminalId.trim() === "") throw new Error("terminalId is required");
	if (options.title.trim() === "") throw new Error("title is required");
	if (options.command.trim() === "") throw new Error("command is required");
	parseMetadata(options.metadata);
}

function parseMetadata(value: unknown): Record<string, string> {
	if (value === undefined || value === null) return {};
	if (!isRecord(value) || Array.isArray(value)) throw new Error("metadata must be an object");
	return Object.fromEntries(
		Object.entries(value).map(([key, metadataValue]) => {
			if (key.trim() === "") throw new Error("metadata keys must not be empty");
			if (typeof metadataValue !== "string") throw new Error("metadata values must be strings");
			return [key, metadataValue];
		}),
	);
}

function matchesCommandRunFilter(run: TerminalCommandRun, filter: TerminalCommandRunFilter): boolean {
	if (filter.projectId !== undefined && run.projectId !== filter.projectId) return false;
	if (filter.workspaceId !== undefined && run.workspaceId !== filter.workspaceId) return false;
	if (filter.terminalId !== undefined && run.terminalId !== filter.terminalId) return false;
	if (filter.statuses !== undefined && filter.statuses.length > 0 && !filter.statuses.includes(run.status)) return false;
	for (const [key, value] of Object.entries(filter.metadata ?? {})) {
		if (run.metadata[key] !== value) return false;
	}
	return true;
}

function isTerminalCommandRunFinal(status: TerminalCommandRunStatus): boolean {
	return status === "succeeded" || status === "failed";
}

function copyCommandRun(run: TerminalCommandRun): TerminalCommandRun {
	return { ...run, metadata: { ...run.metadata } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
