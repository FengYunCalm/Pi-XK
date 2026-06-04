import type { AgentSession } from "../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type { ExtensionRunner } from "../../core/extensions/index.ts";
import type { ModelRegistry } from "../../core/model-registry.ts";
import type { ResourceLoader } from "../../core/resource-loader.ts";
import type { ReadonlySessionManager, SessionManager } from "../../core/session-manager.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";

type MaybePromise<T> = T | Promise<T>;

export type InteractiveExtensionRunner = Pick<
	ExtensionRunner,
	| "emitUserBash"
	| "getCommand"
	| "getRegisteredCommands"
	| "getCommandDiagnostics"
	| "getMessageRenderer"
	| "getShortcutDiagnostics"
> & {
	getShortcuts(
		...args: Parameters<ExtensionRunner["getShortcuts"]>
	): MaybePromise<ReturnType<ExtensionRunner["getShortcuts"]>>;
};

export type InteractiveResourceLoader = Pick<
	ResourceLoader,
	"getAgentsFiles" | "getExtensions" | "getPrompts" | "getSkills" | "getThemes"
>;

export type InteractiveModelRegistry = ModelRegistry;

export type InteractiveSettingsManager = SettingsManager;

export type InteractiveAgent = Pick<AgentSession["agent"], "abort" | "signal" | "transport" | "waitForIdle">;

export interface InteractiveSessionState {
	messages: AgentSession["state"]["messages"];
	model: AgentSession["model"];
	thinkingLevel: AgentSession["thinkingLevel"];
}

export type InteractiveSessionManager = ReadonlySessionManager &
	Pick<SessionManager, "buildSessionContext" | "usesDefaultSessionDir"> & {
		appendLabelChange(targetId: string, label: string | undefined): MaybePromise<string>;
	};

export type InteractiveResumeSessionManager = Pick<
	SessionManager,
	"getCwd" | "getSessionDir" | "getSessionFile" | "getSessionId" | "usesDefaultSessionDir"
>;

export type InteractiveSession = Pick<
	AgentSession,
	| "abortBash"
	| "abortBranchSummary"
	| "abortCompaction"
	| "abortRetry"
	| "autoCompactionEnabled"
	| "bindExtensions"
	| "clearQueue"
	| "compact"
	| "cycleModel"
	| "cycleThinkingLevel"
	| "executeBash"
	| "exportToHtml"
	| "exportToJsonl"
	| "followUp"
	| "followUpMode"
	| "getAvailableThinkingLevels"
	| "getContextUsage"
	| "getFollowUpMessages"
	| "getSteeringMessages"
	| "getToolDefinition"
	| "isBashRunning"
	| "isCompacting"
	| "isStreaming"
	| "messages"
	| "model"
	| "navigateTree"
	| "pendingMessageCount"
	| "prompt"
	| "promptTemplates"
	| "recordBashResult"
	| "reload"
	| "retryAttempt"
	| "scopedModels"
	| "setAutoCompactionEnabled"
	| "setFollowUpMode"
	| "setModel"
	| "setScopedModels"
	| "setSessionName"
	| "setSteeringMode"
	| "setThinkingLevel"
	| "steer"
	| "steeringMode"
	| "subscribe"
	| "systemPrompt"
	| "thinkingLevel"
> & {
	readonly agent: InteractiveAgent;
	readonly extensionRunner: InteractiveExtensionRunner;
	readonly modelRegistry: InteractiveModelRegistry;
	readonly resourceLoader: InteractiveResourceLoader;
	readonly sessionManager: InteractiveSessionManager;
	readonly settingsManager: InteractiveSettingsManager;
	readonly state: InteractiveSessionState;
	getLastAssistantText(): MaybePromise<string | undefined>;
	getSessionStats(): MaybePromise<ReturnType<AgentSession["getSessionStats"]>>;
	getUserMessagesForForking(): MaybePromise<Array<{ entryId: string; text: string }>>;
};

export interface InteractiveRuntimeHost {
	readonly session: InteractiveSession;
	readonly services: AgentSessionRuntime["services"];
	setBeforeSessionInvalidate: AgentSessionRuntime["setBeforeSessionInvalidate"];
	setRebindSession(rebindSession?: (session: InteractiveSession) => Promise<void>): void;
	newSession: AgentSessionRuntime["newSession"];
	fork: AgentSessionRuntime["fork"];
	switchSession: AgentSessionRuntime["switchSession"];
	importFromJsonl: AgentSessionRuntime["importFromJsonl"];
	dispose: AgentSessionRuntime["dispose"];
}
