import { html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { isSessionActive } from "../../../shared/activity";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import { isCachedNewSessionInfo } from "../cachedNewSessions";
import { actionMenuId, actionMenuPanelStyle, focusActionMenuToggle, focusFirstActionMenuItem } from "./actionMenu";
import { renderActivityIndicator } from "./activityBadge";
import { activateSelectableRow, activateSelectableRowFromKeyboard } from "./selectableRow";
import { listStyles } from "./shared";

function sessionLabel(session: SessionInfo): string {
	if (session.name !== undefined && session.name !== "") return session.name;
	return session.firstMessage !== "" ? session.firstMessage : session.id.slice(0, 8);
}

interface SessionRow {
	session: SessionInfo;
	depth: number;
	hasMissingParent: boolean;
}

@customElement("session-list")
export class SessionList extends LitElement {
	@property({ attribute: false }) sessions: SessionInfo[] = [];
	@property({ attribute: false }) statuses: Record<string, SessionStatus> = {};
	@property({ attribute: false }) activities: Record<string, SessionActivity> = {};
	@property({ attribute: false }) selected?: SessionInfo;
	@property({ type: Boolean }) canStart = false;
	@property({ type: Boolean, reflect: true }) collapsible = false;
	@property({ type: Boolean, reflect: true }) collapsed = false;
	@property({ attribute: false }) onSelect?: (session: SessionInfo) => void;
	@property({ attribute: false }) onStart?: () => void;
	@property({ attribute: false }) onToggleCollapsed?: () => void;
	@state() private openMenuSessionId: string | undefined;
	@state() private menuStyle = "";
	private readonly onDocumentClick = (event: MouseEvent) => {
		if (event.composedPath().includes(this)) return;
		this.openMenuSessionId = undefined;
	};
	@property({ attribute: false }) onDelete?: (session: SessionInfo) => void;
	@property({ attribute: false }) onDetachParent?: (session: SessionInfo) => void;

	override connectedCallback(): void {
		super.connectedCallback();
		document.addEventListener("click", this.onDocumentClick);
	}

	override disconnectedCallback(): void {
		document.removeEventListener("click", this.onDocumentClick);
		super.disconnectedCallback();
	}

	protected override updated(changed: PropertyValues<this>): void {
		if (
			changed.has("sessions") &&
			this.openMenuSessionId !== undefined &&
			!this.sessions.some((session) => session.id === this.openMenuSessionId)
		)
			this.openMenuSessionId = undefined;
		if (changed.has("collapsed") && this.collapsed) this.openMenuSessionId = undefined;
		if ((changed.has("selected") || changed.has("sessions") || changed.has("collapsed")) && !this.collapsed)
			this.scrollSelectedIntoView();
	}

	override render() {
		const rows = sessionRows(this.sessions);
		const descendantCounts = descendantCountsByParent(this.sessions);
		return html`
      <section>
        ${this.renderHeading(rows.length)}
        ${
				this.collapsed
					? null
					: html`
          <div class="list-body">
            ${rows.map((row) => this.renderSession(row, descendantCounts.get(row.session.id) ?? 0))}
          </div>
        `
			}
      </section>
    `;
	}

	private renderHeading(sessionCount: number) {
		if (!this.collapsible)
			return html`<h2>Sessions <button ?disabled=${!this.canStart} @click=${() => this.onStart?.()}>+</button></h2>`;
		const selectedSummary = this.selected === undefined ? "No session selected" : sessionLabel(this.selected);
		const selectedTitle = this.selected?.path ?? selectedSummary;
		return html`
      <h2>
        <button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => {
				this.onToggleCollapsed?.();
			}}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} Sessions</span><small class="section-selected" title=${selectedTitle}>${selectedSummary}</small></span><small class="section-count">${sessionCount}</small></button>
        <button ?disabled=${!this.canStart} @click=${(event: MouseEvent) => {
				event.stopPropagation();
				this.onStart?.();
			}}>+</button>
      </h2>
    `;
	}

	private renderSession(row: SessionRow, descendantCount: number) {
		const { session } = row;
		const cappedDepth = Math.min(row.depth, 2);
		const open = this.openMenuSessionId === session.id;
		const menuId = sessionMenuId(session.id);
		return html`
      <div
        class="action-row ${this.selected?.id === session.id ? "selected" : ""}"
        style=${`--depth:${String(cappedDepth)}`}
        tabindex="0"
        title=${session.path}
        @click=${(event: MouseEvent) => {
				activateSelectableRow(event, () => this.onSelect?.(session));
			}}
        @keydown=${(event: KeyboardEvent) => {
				activateSelectableRowFromKeyboard(event, () => this.onSelect?.(session));
			}}
      >
        <div class="action-main">
          <span class="action-name">${row.depth > 0 ? html`<span class="tree-marker">↳</span>` : null}${sessionLabel(session)}${row.depth > 2 ? html` <span class="badge">depth ${row.depth}</span>` : null}${row.hasMissingParent ? html` <span class="badge">parent unavailable</span>` : null}</span><small>${this.renderStatus(session)}${String(session.messageCount)} messages</small>
        </div>
        <div class="action-menu">
					<button class="action-menu-toggle" title="Session actions" aria-label=${`Actions for ${sessionLabel(session)}`} aria-haspopup="menu" aria-expanded=${String(
						open,
					)} aria-controls=${menuId} @click=${(event: MouseEvent) => {
					event.stopPropagation();
					this.toggleMenu(session.id, event.currentTarget);
				}}>⋯</button>
          ${
					open
						? html`
			<div class="action-menu-panel" id=${menuId} role="menu" tabindex="-1" style=${this.menuStyle} @click=${(event: MouseEvent) => {
							event.stopPropagation();
						}} @keydown=${(event: KeyboardEvent) => {
							this.handleMenuKeydown(event, session.id);
						}}>
              ${
						session.parentSessionPath !== undefined
							? html`<button role="menuitem" title="Detach from parent" @click=${() => {
									this.openMenuSessionId = undefined;
									this.onDetachParent?.(session);
								}}>Detach from parent</button>`
							: null
					}
              ${
						isCachedNewSessionInfo(session)
							? html`<button role="menuitem" title="Delete browser-cached new session" @click=${() => {
									this.openMenuSessionId = undefined;
									this.onDelete?.(session);
								}}>Delete</button>`
							: null
					}
            </div>
          `
						: null
				}
        </div>
      </div>
    `;
	}

	private toggleMenu(sessionId: string, target: EventTarget | null) {
		if (this.openMenuSessionId === sessionId) {
			this.openMenuSessionId = undefined;
			return;
		}
		this.menuStyle = actionMenuPanelStyle(target);
		this.openMenuSessionId = sessionId;
		void this.focusOpenMenu(sessionMenuId(sessionId));
	}

	private async focusOpenMenu(menuId: string): Promise<void> {
		await this.updateComplete;
		focusFirstActionMenuItem(this.renderRoot, menuId);
	}

	private handleMenuKeydown(event: KeyboardEvent, sessionId: string): void {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		this.openMenuSessionId = undefined;
		void this.updateComplete.then(() => {
			focusActionMenuToggle(this.renderRoot, sessionMenuId(sessionId));
		});
	}

	private scrollSelectedIntoView(): void {
		this.renderRoot.querySelector<HTMLElement>(".action-row.selected")?.scrollIntoView({ block: "nearest" });
	}

	private renderStatus(session: SessionInfo) {
		if (isCachedNewSessionInfo(session)) return "new · ";
		return (
			renderActivityIndicator(
				isSessionActive(this.statuses[session.id], this.activities[session.id]) ? "session" : undefined,
				"Session active",
			) ?? ""
		);
	}

	static override styles = listStyles;
}

function descendantCountsByParent(sessions: SessionInfo[]): Map<string, number> {
	const childrenByParentPath = new Map<string, SessionInfo[]>();
	for (const session of sessions) {
		if (session.parentSessionPath === undefined) continue;
		const children = childrenByParentPath.get(session.parentSessionPath) ?? [];
		children.push(session);
		childrenByParentPath.set(session.parentSessionPath, children);
	}

	const countFor = (session: SessionInfo, seenPaths: Set<string>): number => {
		if (seenPaths.has(session.path)) return 0;
		const nextSeenPaths = new Set(seenPaths);
		nextSeenPaths.add(session.path);
		let count = 0;
		for (const child of childrenByParentPath.get(session.path) ?? []) {
			if (nextSeenPaths.has(child.path)) continue;
			count += 1;
			count += countFor(child, nextSeenPaths);
		}
		return count;
	};

	return new Map(sessions.map((session) => [session.id, countFor(session, new Set())]));
}

function sessionRows(sessions: SessionInfo[]): SessionRow[] {
	const byPath = new Map(sessions.map((session) => [session.path, session]));
	const childrenByPath = new Map<string, SessionInfo[]>();
	const roots: SessionInfo[] = [];
	for (const session of sessions) {
		const parentPath = session.parentSessionPath;
		const parent = parentPath === undefined ? undefined : byPath.get(parentPath);
		if (parent === undefined) {
			roots.push(session);
			continue;
		}
		const children = childrenByPath.get(parent.path) ?? [];
		children.push(session);
		childrenByPath.set(parent.path, children);
	}

	const rows: SessionRow[] = [];
	const visit = (session: SessionInfo, depth: number, stack: Set<string>) => {
		if (stack.has(session.path)) return;
		const parentPath = session.parentSessionPath;
		rows.push({ session, depth, hasMissingParent: parentPath !== undefined && !byPath.has(parentPath) });
		const nextStack = new Set(stack);
		nextStack.add(session.path);
		for (const child of childrenByPath.get(session.path) ?? []) visit(child, depth + 1, nextStack);
	};
	for (const root of roots) visit(root, 0, new Set());
	return rows;
}

function sessionMenuId(sessionId: string): string {
	return actionMenuId("session-menu", sessionId);
}
