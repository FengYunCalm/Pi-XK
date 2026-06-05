import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AppState } from "../appState";

export type ResizablePanelSide = "navigation" | "workspace";

const NAVIGATION_PANEL_DEFAULT_WIDTH = 340;
const NAVIGATION_PANEL_MIN_WIDTH = 240;
const NAVIGATION_PANEL_MAX_WIDTH = 560;
const WORKSPACE_PANEL_DEFAULT_WIDTH = 520;
const WORKSPACE_PANEL_MIN_WIDTH = 320;
const WORKSPACE_PANEL_MAX_WIDTH = 760;
const STORAGE_PREFIX = "pi-web:panel-width:";

export class PanelCollapseController implements ReactiveController {
	navigationPanelCollapsed = false;
	workspacePanelCollapsed = false;
	navigationPanelWidth = readStoredPanelWidth(
		"navigation",
		NAVIGATION_PANEL_DEFAULT_WIDTH,
		NAVIGATION_PANEL_MIN_WIDTH,
		NAVIGATION_PANEL_MAX_WIDTH,
	);
	workspacePanelWidth = readStoredPanelWidth(
		"workspace",
		WORKSPACE_PANEL_DEFAULT_WIDTH,
		WORKSPACE_PANEL_MIN_WIDTH,
		WORKSPACE_PANEL_MAX_WIDTH,
	);
	private resizing: { side: ResizablePanelSide; startX: number; startWidth: number } | undefined;
	private readonly host: ReactiveControllerHost;

	hostConnected(): void {
		return;
	}

	constructor(host: ReactiveControllerHost) {
		this.host = host;
		host.addController(this);
	}

	toggleNavigationPanel(): void {
		this.navigationPanelCollapsed = !this.navigationPanelCollapsed;
		this.host.requestUpdate();
	}

	toggleWorkspacePanel(): void {
		this.workspacePanelCollapsed = !this.workspacePanelCollapsed;
		this.host.requestUpdate();
	}

	startResize(side: ResizablePanelSide, clientX: number): void {
		if (side === "navigation") this.navigationPanelCollapsed = false;
		else this.workspacePanelCollapsed = false;
		this.resizing = {
			side,
			startX: clientX,
			startWidth: side === "navigation" ? this.navigationPanelWidth : this.workspacePanelWidth,
		};
		this.host.requestUpdate();
	}

	resize(clientX: number): void {
		if (this.resizing === undefined) return;
		const delta = clientX - this.resizing.startX;
		const nextWidth = this.resizing.startWidth + (this.resizing.side === "navigation" ? delta : -delta);
		this.setPanelWidth(this.resizing.side, nextWidth, false);
	}

	endResize(): void {
		if (this.resizing === undefined) return;
		persistPanelWidth(
			this.resizing.side,
			this.resizing.side === "navigation" ? this.navigationPanelWidth : this.workspacePanelWidth,
		);
		this.resizing = undefined;
		this.host.requestUpdate();
	}

	shellStyle(): string {
		return `--navigation-panel-width: ${String(this.navigationPanelWidth)}px; --workspace-panel-width: ${String(this.workspacePanelWidth)}px;`;
	}

	shellClass(mainView: AppState["mainView"]): string {
		return [
			"shell",
			mainViewClass(mainView),
			...(this.navigationPanelCollapsed ? ["navigation-panel-collapsed"] : []),
			...(this.workspacePanelCollapsed ? ["workspace-panel-collapsed"] : []),
			...(this.resizing !== undefined ? ["panel-resizing"] : []),
		].join(" ");
	}

	private setPanelWidth(side: ResizablePanelSide, width: number, persist: boolean): void {
		if (side === "navigation") {
			this.navigationPanelWidth = clamp(width, NAVIGATION_PANEL_MIN_WIDTH, NAVIGATION_PANEL_MAX_WIDTH);
			if (persist) persistPanelWidth(side, this.navigationPanelWidth);
		} else {
			this.workspacePanelWidth = clamp(width, WORKSPACE_PANEL_MIN_WIDTH, WORKSPACE_PANEL_MAX_WIDTH);
			if (persist) persistPanelWidth(side, this.workspacePanelWidth);
		}
		this.host.requestUpdate();
	}
}

export function mainViewClass(mainView: AppState["mainView"]): "navigation-view" | "chat-view" | "workspace-view" {
	if (mainView === "navigation") return "navigation-view";
	if (mainView === "chat") return "chat-view";
	return "workspace-view";
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(Math.round(value), min), max);
}

function readStoredPanelWidth(side: ResizablePanelSide, fallback: number, min: number, max: number): number {
	try {
		const raw = globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${side}`);
		if (raw === null || raw === undefined) return fallback;
		const width = Number.parseInt(raw, 10);
		if (!Number.isFinite(width)) return fallback;
		return clamp(width, min, max);
	} catch {
		return fallback;
	}
}

function persistPanelWidth(side: ResizablePanelSide, width: number): void {
	try {
		globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${side}`, String(width));
	} catch {
		return;
	}
}
