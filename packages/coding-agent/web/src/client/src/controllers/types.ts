import type { AppState } from "../appState";

export type GetState = () => AppState;
export type SetState = (patch: Partial<AppState>) => void;
export type UpdateUrl = (options?: { replace?: boolean | undefined }) => void;

export interface RouteTarget {
	workspaceId?: string | undefined;
	sessionId?: string | undefined;
	updateUrl?: boolean | undefined;
}
