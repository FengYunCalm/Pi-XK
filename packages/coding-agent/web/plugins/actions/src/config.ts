export const ACTIONS_CONFIG_PATH = ".pi-web/actions.json";
export const ACTIONS_CONFIG_VERSION = 1;

const actionIdPattern = /^[a-z][a-z0-9.-]*$/u;

export interface WorkspaceActionsConfig {
  version: typeof ACTIONS_CONFIG_VERSION;
  actions: WorkspaceAction[];
}

export interface WorkspaceAction {
  id: string;
  title: string;
  command: string;
  description?: string;
  group?: string;
  confirm: boolean;
}

export type ParseActionsConfigResult =
  | { ok: true; config: WorkspaceActionsConfig }
  | { ok: false; error: string };

export function parseActionsConfigText(text: string): ParseActionsConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  return parseActionsConfig(parsed);
}

export function parseActionsConfig(value: unknown): ParseActionsConfigResult {
  if (!isRecord(value)) return invalid("Config must be an object");
  if (value["version"] !== ACTIONS_CONFIG_VERSION) return invalid("Config version must be 1");

  const actions = value["actions"];
  if (!Array.isArray(actions)) return invalid("Config actions must be an array");

  const ids = new Set<string>();
  const parsedActions: WorkspaceAction[] = [];
  for (const [index, action] of actions.entries()) {
    const parsedAction = parseAction(action, index);
    if (!parsedAction.ok) return parsedAction;
    if (ids.has(parsedAction.action.id)) return invalid(`Duplicate action id: ${parsedAction.action.id}`);
    ids.add(parsedAction.action.id);
    parsedActions.push(parsedAction.action);
  }

  return { ok: true, config: { version: ACTIONS_CONFIG_VERSION, actions: parsedActions } };
}

type ParseActionResult =
  | { ok: true; action: WorkspaceAction }
  | { ok: false; error: string };

function parseAction(value: unknown, index: number): ParseActionResult {
  const label = `Action ${String(index + 1)}`;
  if (!isRecord(value)) return invalid(`${label} must be an object`);

  const id = requireNonEmptyString(value, "id", label);
  if (!id.ok) return id;
  if (!actionIdPattern.test(id.value)) return invalid(`${label} id must match ${actionIdPattern.source}`);

  const title = requireNonEmptyString(value, "title", label);
  if (!title.ok) return title;

  const command = requireNonEmptyString(value, "command", label);
  if (!command.ok) return command;

  const description = optionalNonEmptyString(value, "description", label);
  if (!description.ok) return description;

  const group = optionalNonEmptyString(value, "group", label);
  if (!group.ok) return group;

  const confirm = value["confirm"];
  if (confirm !== undefined && typeof confirm !== "boolean") return invalid(`${label} confirm must be a boolean`);

  return {
    ok: true,
    action: {
      id: id.value,
      title: title.value,
      command: command.value,
      ...(description.value === undefined ? {} : { description: description.value }),
      ...(group.value === undefined ? {} : { group: group.value }),
      confirm: confirm ?? false,
    },
  };
}

type StringFieldResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

type OptionalStringFieldResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

function requireNonEmptyString(record: Record<string, unknown>, key: string, label: string): StringFieldResult {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") return invalid(`${label} ${key} must be a non-empty string`);
  return { ok: true, value };
}

function optionalNonEmptyString(record: Record<string, unknown>, key: string, label: string): OptionalStringFieldResult {
  const value = record[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || value.trim() === "") return invalid(`${label} ${key} must be a non-empty string when provided`);
  return { ok: true, value };
}

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
