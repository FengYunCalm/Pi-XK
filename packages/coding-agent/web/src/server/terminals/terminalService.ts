import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import * as pty from "node-pty";
import type { TerminalCommandRun, TerminalCommandRunFilter, TerminalUiEvent } from "../../shared/apiTypes.ts";
import type { WorkspaceActivityService } from "../activity/workspaceActivityService.ts";
import type { SessionEventHub } from "../realtime/sessionEventHub.ts";
import { TerminalCommandRunStore } from "./terminalCommandRunStore.ts";

const MAX_REPLAY_BUFFER = 200_000;

export interface TerminalInfo {
	id: string;
	cwd: string;
	name: string;
	createdAt: string;
	exited: boolean;
	exitCode?: number;
	commandRunId?: string;
}

export interface RunTerminalCommandOptions {
	origin: string;
	projectId: string;
	workspaceId: string;
	cwd: string;
	title: string;
	command: string;
	metadata?: unknown;
	cols?: number;
	rows?: number;
}

interface TerminalRecord extends TerminalInfo {
	pty: pty.IPty;
	buffer: string;
	events: EventEmitter;
	commandRunId?: string;
}

export class TerminalService {
	private readonly terminals = new Map<string, TerminalRecord>();
	private readonly commandRuns = new TerminalCommandRunStore();
	private readonly events: SessionEventHub | undefined;
	private readonly workspaceActivity: Pick<WorkspaceActivityService, "updateTerminal" | "removeTerminal"> | undefined;

	constructor(
		events?: SessionEventHub,
		workspaceActivity?: Pick<WorkspaceActivityService, "updateTerminal" | "removeTerminal">,
	) {
		this.events = events;
		this.workspaceActivity = workspaceActivity;
	}

	list(cwd: string): TerminalInfo[] {
		return [...this.terminals.values()].filter((terminal) => terminal.cwd === cwd).map(toInfo);
	}

	create(options: { cwd: string; name?: string; cols?: number; rows?: number }): TerminalInfo {
		return this.createTerminal({ ...options, shellArgs: [] });
	}

	runCommand(options: RunTerminalCommandOptions): TerminalCommandRun {
		if (options.cwd.trim() === "") throw new Error("cwd is required");
		const terminalId = randomUUID();
		const run = this.commandRuns.start({
			origin: options.origin,
			projectId: options.projectId,
			workspaceId: options.workspaceId,
			terminalId,
			title: options.title,
			command: options.command,
			metadata: options.metadata,
		});

		try {
			this.createTerminal({
				id: terminalId,
				cwd: options.cwd,
				name: options.title,
				...(options.cols === undefined ? {} : { cols: options.cols }),
				...(options.rows === undefined ? {} : { rows: options.rows }),
				shellArgs: ["-lc", commandRunShellScript(options.command)],
				commandRunId: run.id,
			});
		} catch (error) {
			this.commandRuns.delete(run.id);
			throw error;
		}

		return this.commandRuns.get(run.id) ?? run;
	}

	listCommandRuns(filter: TerminalCommandRunFilter = {}): TerminalCommandRun[] {
		return this.commandRuns.list(filter);
	}

	getCommandRun(runId: string): TerminalCommandRun | undefined {
		return this.commandRuns.get(runId);
	}

	cancelCommandRun(runId: string): TerminalCommandRun {
		const run = this.commandRuns.get(runId);
		if (run === undefined) throw new Error("Terminal command run not found");
		if (this.commandRuns.isFinal(run.id)) return run;
		const terminal = this.terminals.get(run.terminalId);
		if (terminal === undefined) throw new Error("Terminal not found");
		if (!terminal.exited) terminal.pty.write("\x03");
		return run;
	}

	get(id: string): TerminalInfo | undefined {
		const terminal = this.terminals.get(id);
		return terminal === undefined ? undefined : toInfo(terminal);
	}

	attach(
		id: string,
		handlers: { output: (data: string, replay: boolean) => void; exit: (exitCode: number | undefined) => void },
	): () => void {
		const terminal = this.require(id);
		if (terminal.buffer !== "") handlers.output(terminal.buffer, true);
		if (terminal.exited) handlers.exit(terminal.exitCode);
		const onOutput = (data: string) => {
			handlers.output(data, false);
		};
		const onExit = (exitCode: number | undefined) => {
			handlers.exit(exitCode);
		};
		terminal.events.on("output", onOutput);
		terminal.events.on("exit", onExit);
		return () => {
			terminal.events.off("output", onOutput);
			terminal.events.off("exit", onExit);
		};
	}

	write(id: string, data: string): void {
		const terminal = this.require(id);
		if (!terminal.exited) terminal.pty.write(data);
	}

	resize(id: string, cols: number, rows: number): void {
		const terminal = this.require(id);
		if (!terminal.exited && Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
			terminal.pty.resize(Math.floor(cols), Math.floor(rows));
		}
	}

	continue(id: string): TerminalInfo {
		const record = this.require(id);
		if (!record.exited) return toInfo(record);
		delete record.exitCode;
		delete record.commandRunId;
		record.exited = false;
		const marker = "\r\n[continued in interactive shell]\r\n";
		record.buffer = trimReplayBuffer(record.buffer + marker);
		record.events.emit("output", marker);
		const shell = process.env["SHELL"] ?? "/bin/bash";
		record.pty = pty.spawn(shell, [], {
			name: "xterm-256color",
			cwd: record.cwd,
			cols: 100,
			rows: 30,
			env: { ...process.env, TERM: "xterm-256color" },
		});
		this.attachPtyEvents(record);
		const info = toInfo(record);
		this.workspaceActivity?.updateTerminal(info);
		this.publish({ type: "terminal.created", terminal: info });
		return info;
	}

	close(id: string): void {
		const terminal = this.terminals.get(id);
		if (terminal === undefined) return;
		this.terminals.delete(id);
		terminal.events.removeAllListeners();
		this.workspaceActivity?.removeTerminal(id, terminal.cwd);
		if (!terminal.exited) terminal.pty.kill();
		this.publish({ type: "terminal.closed", terminalId: id, cwd: terminal.cwd });
	}

	dispose(): void {
		for (const id of [...this.terminals.keys()]) this.close(id);
	}

	private createTerminal(options: {
		id?: string;
		cwd: string;
		name?: string;
		cols?: number;
		rows?: number;
		shellArgs: string[];
		commandRunId?: string;
	}): TerminalInfo {
		if (options.cwd === "") throw new Error("cwd is required");
		const id = options.id ?? randomUUID();
		const createdAt = new Date().toISOString();
		const shell = process.env["SHELL"] ?? "/bin/bash";
		const terminal = pty.spawn(shell, options.shellArgs, {
			name: "xterm-256color",
			cwd: options.cwd,
			cols: options.cols ?? 100,
			rows: options.rows ?? 30,
			env: { ...process.env, TERM: "xterm-256color" },
		});
		const requestedName = options.name?.trim();
		const record: TerminalRecord = {
			id,
			cwd: options.cwd,
			name:
				requestedName !== undefined && requestedName !== ""
					? requestedName
					: `Shell ${String(this.list(options.cwd).length + 1)}`,
			createdAt,
			exited: false,
			pty: terminal,
			buffer: "",
			events: new EventEmitter(),
			...(options.commandRunId === undefined ? {} : { commandRunId: options.commandRunId }),
		};
		this.attachPtyEvents(record);
		this.terminals.set(id, record);
		const info = toInfo(record);
		this.workspaceActivity?.updateTerminal(info);
		this.publish({ type: "terminal.created", terminal: info });
		return info;
	}

	private attachPtyEvents(record: TerminalRecord): void {
		record.pty.onData((data) => {
			record.buffer = trimReplayBuffer(record.buffer + data);
			record.events.emit("output", data);
		});
		record.pty.onExit(({ exitCode }) => {
			record.exited = true;
			record.exitCode = exitCode;
		this.commandRuns.complete(record.commandRunId, exitCode);
			record.events.emit("exit", exitCode);
			const info = toInfo(record);
			this.workspaceActivity?.updateTerminal(info);
			this.publish({ type: "terminal.exited", terminal: info });
		});
	}

	private require(id: string): TerminalRecord {
		const terminal = this.terminals.get(id);
		if (terminal === undefined) throw new Error("Terminal not found");
		return terminal;
	}

	private publish(event: TerminalUiEvent): void {
		this.events?.publishRealtime(event);
	}
}

function toInfo(record: TerminalRecord): TerminalInfo {
	return {
		id: record.id,
		cwd: record.cwd,
		name: record.name,
		createdAt: record.createdAt,
		exited: record.exited,
		...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
		...(record.commandRunId === undefined ? {} : { commandRunId: record.commandRunId }),
	};
}

function trimReplayBuffer(buffer: string): string {
	if (buffer.length <= MAX_REPLAY_BUFFER) return buffer;
	return buffer.slice(buffer.length - MAX_REPLAY_BUFFER);
}

function commandRunShellScript(command: string): string {
	return `printf '%s\\n' ${shellQuote(`$ ${command}`)}\n${command}`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
