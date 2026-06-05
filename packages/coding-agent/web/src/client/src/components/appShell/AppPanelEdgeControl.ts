import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

export type PanelEdgeSide = "navigation" | "workspace";

@customElement("app-panel-edge-control")
export class AppPanelEdgeControl extends LitElement {
	@property({ reflect: true }) side: PanelEdgeSide = "navigation";
	@property({ type: Boolean, reflect: true }) collapsed = false;
	@property() controls = "";
	@property() expandLabel = "Expand panel";
	@property() collapseLabel = "Collapse panel";
	@property({ attribute: false }) onToggle?: () => void;
	@property({ attribute: false }) onResizeStart?: (clientX: number) => void;
	@property({ attribute: false }) onResizeMove?: (clientX: number) => void;
	@property({ attribute: false }) onResizeEnd?: () => void;
	private dragging = false;
	private readonly onWindowPointerMove = (event: PointerEvent) => {
		if (!this.dragging) return;
		event.preventDefault();
		this.onResizeMove?.(event.clientX);
	};
	private readonly onWindowPointerUp = () => {
		this.stopDrag();
	};

	override render() {
		const label = this.collapsed ? this.expandLabel : this.collapseLabel;
		return html`
      <div class="resize-handle" aria-hidden="true" @pointerdown=${this.startDrag}></div>
      <button
        type="button"
        class="edge-button"
        title=${label}
        aria-label=${label}
        aria-controls=${this.controls}
        aria-expanded=${String(!this.collapsed)}
        @click=${() => {
				this.onToggle?.();
			}}
      >${this.renderIcon()}</button>
    `;
	}

	override disconnectedCallback(): void {
		this.stopDrag();
		super.disconnectedCallback();
	}

	private readonly startDrag = (event: PointerEvent) => {
		if (this.collapsed || event.button !== 0) return;
		event.preventDefault();
		this.dragging = true;
		this.setAttribute("dragging", "");
		this.onResizeStart?.(event.clientX);
		window.addEventListener("pointermove", this.onWindowPointerMove);
		window.addEventListener("pointerup", this.onWindowPointerUp, { once: true });
	};

	private stopDrag(): void {
		if (!this.dragging) return;
		this.dragging = false;
		this.removeAttribute("dragging");
		window.removeEventListener("pointermove", this.onWindowPointerMove);
		window.removeEventListener("pointerup", this.onWindowPointerUp);
		this.onResizeEnd?.();
	}

	private renderIcon() {
		const direction = this.iconDirection();
		const path = direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6";
		return html`<svg class="edge-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d=${path}/></svg>`;
	}

	private iconDirection(): "left" | "right" {
		if (this.side === "navigation") return this.collapsed ? "right" : "left";
		return this.collapsed ? "left" : "right";
	}

	static override styles = css`
	    :host { position: relative; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: visible; background: transparent; z-index: 2; }
    :host([side="navigation"]) { grid-column: 2; }
    :host([side="workspace"]) { grid-column: 4; }
	    .resize-handle { position: absolute; inset: 0; cursor: col-resize; touch-action: none; }
	    :host([collapsed]) .resize-handle { display: none; }
	    .edge-button { position: relative; z-index: 1; box-sizing: border-box; display: grid; place-items: center; width: 18px; height: 48px; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-bg); color: var(--pi-muted); opacity: .75; cursor: pointer; transition: transform .16s ease, background .16s ease, border-color .16s ease, color .16s ease, opacity .16s ease; }
	    .edge-button:hover, .edge-button:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
	    :host([dragging]) .edge-button { border-color: var(--pi-accent-border); color: var(--pi-text-bright); background: var(--pi-selection-bg); opacity: 1; }
    :host([side="navigation"][collapsed]) .edge-button { transform: translateX(calc(50% - .5px)); }
    :host([side="workspace"][collapsed]) .edge-button { transform: translateX(calc(-50% + .5px)); }
    .edge-icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    @media (max-width: 1180px) {
      :host([side="navigation"]) { grid-row: 1 / 3; }
      :host([side="workspace"]) { display: none; }
    }
    @media (max-width: 760px) {
      :host([side="navigation"]) { display: none; }
    }
  `;
}
