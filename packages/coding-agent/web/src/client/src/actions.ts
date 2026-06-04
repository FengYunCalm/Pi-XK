export interface AppAction {
	id: string;
	title: string;
	description?: string;
	shortcut?: string;
	group?: string;
	enabled?: boolean;
	run: () => void | Promise<void>;
}

export function enabledActions(actions: AppAction[]): AppAction[] {
	return actions.filter((action) => action.enabled !== false);
}
