import { html } from "lit";
import type { PiWebPlugin } from "../types";

export const examplePlugin: PiWebPlugin = {
	apiVersion: 1,
	name: "Example Plugin",
	activate: () => ({
		contributions: {
			actions: [
				{
					id: "workspace.show-path",
					title: "Show Current Workspace Path",
					group: "Example",
					enabled: (context) => context.state.selectedWorkspace !== undefined,
					run: (context) => {
						const path = context.state.selectedWorkspace?.path ?? "No workspace selected";
						window.alert(path);
					},
				},
			],
			workspaceLabels: [
				{
					id: "workspace.example-label",
					order: 100,
					items: (context) => [
						{ type: "text", text: context.workspace.isGitRepo ? "git" : "folder", title: context.workspace.path },
					],
				},
			],
			workspacePanels: [
				{
					id: "workspace.info",
					title: "Info",
					order: 100,
					render: (context) => html`
            <section class="toolbar"><strong>Info</strong></section>
            <section class="viewer">
              <p><strong>Workspace</strong></p>
              <p class="muted">${context.workspace.label}</p>
              <p class="muted">${context.workspace.path}</p>
            </section>
          `,
				},
			],
		},
	}),
};
