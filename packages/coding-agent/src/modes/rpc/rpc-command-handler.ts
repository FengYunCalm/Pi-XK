import type { AgentSession } from "../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type { RpcCommand, RpcResponse, RpcSessionSnapshot, RpcSessionState, RpcSlashCommand } from "./rpc-types.ts";

export interface RpcCommandHandlerOptions {
	runtimeHost: AgentSessionRuntime;
	session: AgentSession;
	command: RpcCommand;
	respond: (response: RpcResponse) => void;
	afterSessionRebind?: () => Promise<void>;
	withExtensionUI?: <T>(work: () => Promise<T>) => Promise<T>;
	promptResponseMode: "preflight" | "immediate";
}

export async function handleRpcCommand(options: RpcCommandHandlerOptions): Promise<RpcResponse | undefined> {
	const { runtimeHost, session, command } = options;
	const id = command.id;
	const withExtensionUI = options.withExtensionUI ?? ((work) => work());

	switch (command.type) {
		case "prompt":
			return handlePromptCommand({ ...options, command });
		case "steer":
			await session.steer(command.message, command.images);
			return rpcResponseSuccess(id, "steer");
		case "follow_up":
			await session.followUp(command.message, command.images);
			return rpcResponseSuccess(id, "follow_up");
		case "abort":
			await session.abort();
			return rpcResponseSuccess(id, "abort");
		case "new_session": {
			const result = await withExtensionUI(() =>
				runtimeHost.newSession(command.parentSession ? { parentSession: command.parentSession } : undefined),
			);
			if (!result.cancelled) await options.afterSessionRebind?.();
			return rpcResponseSuccess(id, "new_session", result);
		}
		case "get_state":
			return rpcResponseSuccess(id, "get_state", rpcSessionState(session));
		case "set_model": {
			const models = await session.modelRegistry.getAvailable();
			const model = models.find(
				(candidate) => candidate.provider === command.provider && candidate.id === command.modelId,
			);
			if (model === undefined) {
				return rpcResponseError(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
			}
			await session.setModel(model);
			return rpcResponseSuccess(id, "set_model", model);
		}
		case "set_scoped_models": {
			const scopedModels = command.scopedModels.map((scopedModel) => {
				const model = session.modelRegistry.find(scopedModel.provider, scopedModel.modelId);
				if (!model) throw new Error(`Model not found: ${scopedModel.provider}/${scopedModel.modelId}`);
				return { model, thinkingLevel: scopedModel.thinkingLevel };
			});
			session.setScopedModels(scopedModels);
			return rpcResponseSuccess(id, "set_scoped_models");
		}
		case "cycle_model":
			return rpcResponseSuccess(id, "cycle_model", (await session.cycleModel(command.direction)) ?? null);
		case "get_available_models":
			return rpcResponseSuccess(id, "get_available_models", { models: await session.modelRegistry.getAvailable() });
		case "set_thinking_level":
			session.setThinkingLevel(command.level);
			return rpcResponseSuccess(id, "set_thinking_level");
		case "cycle_thinking_level": {
			const level = session.cycleThinkingLevel();
			return rpcResponseSuccess(id, "cycle_thinking_level", level === undefined ? null : { level });
		}
		case "get_available_thinking_levels":
			return rpcResponseSuccess(id, "get_available_thinking_levels", {
				levels: session.getAvailableThinkingLevels(),
			});
		case "set_steering_mode":
			session.setSteeringMode(command.mode);
			return rpcResponseSuccess(id, "set_steering_mode");
		case "set_follow_up_mode":
			session.setFollowUpMode(command.mode);
			return rpcResponseSuccess(id, "set_follow_up_mode");
		case "get_queue":
			return rpcResponseSuccess(id, "get_queue", {
				steering: [...session.getSteeringMessages()],
				followUp: [...session.getFollowUpMessages()],
			});
		case "clear_queue":
			return rpcResponseSuccess(id, "clear_queue", session.clearQueue());
		case "compact":
			return rpcResponseSuccess(
				id,
				"compact",
				await withExtensionUI(() => session.compact(command.customInstructions)),
			);
		case "set_auto_compaction":
			session.setAutoCompactionEnabled(command.enabled);
			return rpcResponseSuccess(id, "set_auto_compaction");
		case "set_auto_retry":
			session.setAutoRetryEnabled(command.enabled);
			return rpcResponseSuccess(id, "set_auto_retry");
		case "abort_retry":
			session.abortRetry();
			return rpcResponseSuccess(id, "abort_retry");
		case "abort_compaction":
			session.abortCompaction();
			return rpcResponseSuccess(id, "abort_compaction");
		case "abort_branch_summary":
			session.abortBranchSummary();
			return rpcResponseSuccess(id, "abort_branch_summary");
		case "set_transport":
			session.settingsManager.setTransport(command.transport);
			session.agent.transport = command.transport;
			return rpcResponseSuccess(id, "set_transport");
		case "bash":
			return rpcResponseSuccess(
				id,
				"bash",
				await session.executeBash(command.command, undefined, { excludeFromContext: command.excludeFromContext }),
			);
		case "abort_bash":
			session.abortBash();
			return rpcResponseSuccess(id, "abort_bash");
		case "get_session_stats":
			return rpcResponseSuccess(id, "get_session_stats", session.getSessionStats());
		case "export_html":
			return rpcResponseSuccess(id, "export_html", { path: await session.exportToHtml(command.outputPath) });
		case "switch_session": {
			const result = await withExtensionUI(() => runtimeHost.switchSession(command.sessionPath));
			if (!result.cancelled) await options.afterSessionRebind?.();
			return rpcResponseSuccess(id, "switch_session", result);
		}
		case "fork": {
			const result = await withExtensionUI(() => runtimeHost.fork(command.entryId));
			if (!result.cancelled) await options.afterSessionRebind?.();
			return rpcResponseSuccess(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
		}
		case "clone": {
			const leafId = session.sessionManager.getLeafId();
			if (leafId === null) return rpcResponseError(id, "clone", "Cannot clone session: no current entry selected");
			const result = await withExtensionUI(() => runtimeHost.fork(leafId, { position: "at" }));
			if (!result.cancelled) await options.afterSessionRebind?.();
			return rpcResponseSuccess(id, "clone", { cancelled: result.cancelled });
		}
		case "get_fork_messages":
			return rpcResponseSuccess(id, "get_fork_messages", { messages: session.getUserMessagesForForking() });
		case "get_last_assistant_text":
			return rpcResponseSuccess(id, "get_last_assistant_text", { text: session.getLastAssistantText() });
		case "set_session_name": {
			const name = command.name.trim();
			if (!name) return rpcResponseError(id, "set_session_name", "Session name cannot be empty");
			session.setSessionName(name);
			return rpcResponseSuccess(id, "set_session_name");
		}
		case "get_session_snapshot":
			return rpcResponseSuccess(id, "get_session_snapshot", rpcSessionSnapshot(session));
		case "navigate_tree":
			return rpcResponseSuccess(
				id,
				"navigate_tree",
				await withExtensionUI(() =>
					session.navigateTree(command.targetId, {
						summarize: command.summarize,
						customInstructions: command.customInstructions,
						replaceInstructions: command.replaceInstructions,
						label: command.label,
					}),
				),
			);
		case "set_label":
			return rpcResponseSuccess(id, "set_label", {
				id: session.sessionManager.appendLabelChange(command.entryId, command.label),
			});
		case "get_messages":
			return rpcResponseSuccess(id, "get_messages", { messages: session.messages });
		case "get_commands":
			return rpcResponseSuccess(id, "get_commands", { commands: rpcCommandsForSession(session) });
		case "get_shortcuts":
			return rpcResponseSuccess(id, "get_shortcuts", {
				shortcuts: Array.from(session.extensionRunner.getShortcuts(command.keybindings).entries()).map(
					([shortcut, value]) => ({
						shortcut,
						description: value.description,
						extensionPath: value.extensionPath,
					}),
				),
			});
		case "run_shortcut": {
			const shortcut = Array.from(session.extensionRunner.getShortcuts(command.keybindings).entries()).find(
				([key]) => key === command.shortcut,
			)?.[1];
			if (!shortcut) return rpcResponseError(id, "run_shortcut", `Shortcut not found: ${command.shortcut}`);
			await withExtensionUI(async () => {
				await shortcut.handler(session.extensionRunner.createContext());
			});
			return rpcResponseSuccess(id, "run_shortcut");
		}
	}
}

type RpcPromptCommand = Extract<RpcCommand, { type: "prompt" }>;

function handlePromptCommand(
	options: Omit<RpcCommandHandlerOptions, "command"> & { command: RpcPromptCommand },
): RpcResponse | undefined {
	const { session, command, respond } = options;
	const id = command.id;
	const runPrompt = () =>
		session.prompt(command.message, {
			images: command.images,
			streamingBehavior: command.streamingBehavior,
			source: "rpc",
		});

	if (isExtensionPromptCommand(session, command.message) && options.withExtensionUI !== undefined) {
		void options
			.withExtensionUI(runPrompt)
			.then(() => respond(rpcResponseSuccess(id, "prompt")))
			.catch((error: unknown) => respond(rpcResponseError(id, "prompt", errorMessage(error))));
		return undefined;
	}

	if (options.promptResponseMode === "preflight") {
		let preflightSucceeded = false;
		void session
			.prompt(command.message, {
				images: command.images,
				streamingBehavior: command.streamingBehavior,
				source: "rpc",
				preflightResult: (didSucceed) => {
					if (didSucceed) {
						preflightSucceeded = true;
						respond(rpcResponseSuccess(id, "prompt"));
					}
				},
			})
			.catch((error: unknown) => {
				if (!preflightSucceeded) respond(rpcResponseError(id, "prompt", errorMessage(error)));
			});
		return undefined;
	}

	void runPrompt().catch(() => undefined);
	return rpcResponseSuccess(id, "prompt");
}

export function rpcResponseSuccess(
	id: string | undefined,
	command: RpcCommand["type"],
	data?: object | null,
): RpcResponse {
	return data === undefined
		? ({ id, type: "response", command, success: true } as RpcResponse)
		: ({ id, type: "response", command, success: true, data } as RpcResponse);
}

export function rpcResponseError(id: string | undefined, command: string, error: string): RpcResponse {
	return { id, type: "response", command, success: false, error };
}

function rpcSessionState(session: AgentSession): RpcSessionState {
	return {
		model: session.model,
		transport: session.agent.transport,
		scopedModels: [...session.scopedModels],
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		isCompacting: session.isCompacting,
		isBashRunning: session.isBashRunning,
		steeringMode: session.steeringMode,
		followUpMode: session.followUpMode,
		sessionFile: session.sessionFile,
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		autoCompactionEnabled: session.autoCompactionEnabled,
		messageCount: session.messages.length,
		pendingMessageCount: session.pendingMessageCount,
		retryAttempt: session.retryAttempt,
		systemPrompt: session.systemPrompt,
		contextUsage: session.getContextUsage(),
	};
}

function rpcSessionSnapshot(session: AgentSession): RpcSessionSnapshot {
	return {
		header: session.sessionManager.getHeader(),
		entries: session.sessionManager.getEntries(),
		tree: session.sessionManager.getTree(),
		leafId: session.sessionManager.getLeafId(),
		context: session.sessionManager.buildSessionContext(),
	};
}

function rpcCommandsForSession(session: AgentSession): RpcSlashCommand[] {
	return [
		...session.extensionRunner.getRegisteredCommands().map((command) => ({
			name: command.invocationName,
			description: command.description,
			source: "extension" as const,
			sourceInfo: command.sourceInfo,
		})),
		...session.promptTemplates.map((template) => ({
			name: template.name,
			description: template.description,
			source: "prompt" as const,
			sourceInfo: template.sourceInfo,
		})),
		...session.resourceLoader.getSkills().skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill" as const,
			sourceInfo: skill.sourceInfo,
		})),
	];
}

function isExtensionPromptCommand(session: AgentSession, message: string): boolean {
	const trimmed = message.trim();
	if (!trimmed.startsWith("/")) return false;
	const commandName = trimmed.slice(1).split(/\s+/, 1)[0];
	return (
		commandName !== undefined && commandName !== "" && session.extensionRunner.getCommand(commandName) !== undefined
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
