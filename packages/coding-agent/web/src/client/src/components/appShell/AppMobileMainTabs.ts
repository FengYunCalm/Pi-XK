import { css, html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { AppState } from "../../appState";

export interface AppMobileMainTab {
	id: AppState["mainView"];
	label: unknown;
	className?: string | undefined;
}

@customElement("app-mobile-main-tabs")
export class AppMobileMainTabs extends LitElement {
	@property({ attribute: false }) tabs: AppMobileMainTab[] = [];
	@property({ attribute: false }) selectedView: AppState["mainView"] = "chat";
	@property({ attribute: false }) onSelect?: (view: AppState["mainView"]) => void;
	@query(".mobile-tabs") private mobileTabs?: HTMLElement | null;
	@state() private canScrollLeft = false;
	@state() private canScrollRight = false;
	private observedMobileTabs: HTMLElement | undefined;
	private mobileTabsResizeObserver: ResizeObserver | undefined;

	override disconnectedCallback(): void {
		this.mobileTabsResizeObserver?.disconnect();
		this.mobileTabsResizeObserver = undefined;
		this.observedMobileTabs = undefined;
		super.disconnectedCallback();
	}

	override firstUpdated(): void {
		this.observeMobileTabs();
		this.updateScrollState();
	}

	override updated(): void {
		this.observeMobileTabs();
		this.updateScrollState();
	}

	override render() {
		return html`
      <div class=${this.frameClass()}>
        <div class="mobile-tabs" @scroll=${this.onMobileTabsScroll}>
          ${this.tabs.map(
					(tab) => html`
            <button class=${this.tabClass(tab)} @click=${() => {
					this.onSelect?.(tab.id);
				}}>${tab.label}</button>
          `,
				)}
        </div>
      </div>
    `;
	}

	private frameClass(): string {
		return `mobile-tabs-frame${this.canScrollLeft ? " can-scroll-left" : ""}${this.canScrollRight ? " can-scroll-right" : ""}`;
	}

	private tabClass(tab: AppMobileMainTab): string {
		return [
			...(tab.className === undefined ? [] : [tab.className]),
			...(this.selectedView === tab.id ? ["selected"] : []),
		].join(" ");
	}

	private observeMobileTabs(): void {
		const mobileTabs = this.mobileTabsElement();
		if (this.observedMobileTabs === mobileTabs) return;
		this.mobileTabsResizeObserver?.disconnect();
		this.observedMobileTabs = mobileTabs;
		this.mobileTabsResizeObserver = undefined;
		if (mobileTabs === undefined || typeof ResizeObserver === "undefined") return;
		this.mobileTabsResizeObserver = new ResizeObserver(() => {
			this.updateScrollState();
		});
		this.mobileTabsResizeObserver.observe(mobileTabs);
	}

	private updateScrollState(): void {
		const mobileTabs = this.mobileTabsElement();
		const maxScrollLeft = mobileTabs === undefined ? 0 : Math.max(0, mobileTabs.scrollWidth - mobileTabs.clientWidth);
		const canScrollLeft = mobileTabs !== undefined && mobileTabs.scrollLeft > 1;
		const canScrollRight = mobileTabs !== undefined && maxScrollLeft - mobileTabs.scrollLeft > 1;
		if (this.canScrollLeft !== canScrollLeft) this.canScrollLeft = canScrollLeft;
		if (this.canScrollRight !== canScrollRight) this.canScrollRight = canScrollRight;
	}

	private mobileTabsElement(): HTMLElement | undefined {
		const mobileTabs = this.mobileTabs;
		return mobileTabs instanceof HTMLElement ? mobileTabs : undefined;
	}

	private readonly onMobileTabsScroll = () => {
		this.updateScrollState();
	};

	static override styles = css`
    :host { flex: 0 0 auto; min-width: 0; }
    .mobile-tabs-frame { position: relative; display: flex; flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    .mobile-tabs-frame::before, .mobile-tabs-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
    .mobile-tabs-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
    .mobile-tabs-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
    .mobile-tabs-frame.can-scroll-left::before, .mobile-tabs-frame.can-scroll-right::after { opacity: 1; }
    .mobile-tabs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 8px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
    .mobile-tabs button { flex: 0 0 auto; white-space: nowrap; }
    .navigation-tab { display: none; }
    .mobile-tabs button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .tab-badge { display: inline-block; min-width: 14px; margin-left: 4px; border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 0 5px; font-size: 11px; line-height: 16px; text-align: center; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    @media (max-width: 760px) {
      .navigation-tab { display: block; }
    }
  `;
}
