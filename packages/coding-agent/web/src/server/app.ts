import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { registerGitRoutes } from "./gitRoutes.ts";
import { PiWebPluginService } from "./piWebPluginService.ts";
import { getPiWebStatus, getPiWebVersionStatus } from "./piWebStatus.ts";
import { listDirectorySuggestions } from "./projects/directorySuggestions.ts";
import { ProjectService } from "./projects/projectService.ts";
import { installPiWebSecurity, piWebSecurityFromConfig, type PiWebSecurityOptions } from "./security.ts";
import { registerSessionProxyRoutes } from "./sessiond/sessionProxyRoutes.ts";
import { ProjectStore } from "./storage/projectStore.ts";
import { registerTerminalProxyRoutes } from "./terminalProxyRoutes.ts";
import { registerWorkspaceExplorerRoutes } from "./workspaceExplorerRoutes.ts";
import { listFileSuggestions, listPathSuggestions } from "./workspaces/fileSuggestions.ts";
import { WorkspaceService } from "./workspaces/workspaceService.ts";

export interface AppDependencies {
	projects?: ProjectService;
	workspaces?: WorkspaceService;
	piWebPlugins?: Pick<PiWebPluginService, "manifest" | "readAsset">;
	clientDist?: string | false;
	logger?: FastifyServerOptions["logger"];
	security?: PiWebSecurityOptions | false;
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
	const app = Fastify({ logger: deps.logger ?? true });
	installPiWebSecurity(app, deps.security === undefined ? piWebSecurityFromConfig() : deps.security);
	await app.register(fastifyWebsocket);

	const projects = deps.projects ?? new ProjectService(new ProjectStore());
	const workspaces = deps.workspaces ?? new WorkspaceService();
	const piWebPlugins = deps.piWebPlugins ?? new PiWebPluginService();

	app.get("/pi-web-plugins/manifest.json", async () => piWebPlugins.manifest());

	app.get<{ Params: { pluginId: string; "*": string } }>("/pi-web-plugins/:pluginId/*", async (request, reply) => {
		const asset = await piWebPlugins.readAsset(request.params.pluginId, request.params["*"]);
		if (asset === undefined) return reply.code(404).send({ error: "Plugin asset not found" });
		return reply.type(asset.contentType).send(asset.content);
	});

	app.get("/api/pi-web/status", async () => getPiWebStatus());
	app.get("/api/pi-web/version", async () => getPiWebVersionStatus());

	app.get("/api/projects", async () => projects.list());

	app.post<{ Body: { name?: string; path: string; create?: boolean } }>("/api/projects", async (request, reply) => {
		try {
			return await projects.add(request.body);
		} catch (error) {
			return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	app.delete<{ Params: { projectId: string } }>("/api/projects/:projectId", async (request, reply) => {
		try {
			await projects.close(request.params.projectId);
			return { closed: true };
		} catch (error) {
			return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	app.get<{ Querystring: { q?: string } }>("/api/project-directories", async (request, reply) => {
		try {
			return await listDirectorySuggestions(request.query.q ?? "");
		} catch (error) {
			return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspaces", async (request, reply) => {
		try {
			const project = await projects.requireProject(request.params.projectId);
			return await workspaces.list(project);
		} catch (error) {
			return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	registerSessionProxyRoutes(app);
	registerWorkspaceExplorerRoutes(app, projects, workspaces);
	registerGitRoutes(app, projects, workspaces);
	registerTerminalProxyRoutes(app, projects, workspaces);

	app.get<{
		Querystring: {
			cwd?: string;
			q?: string;
			kind?: "tracked" | "untracked" | "other";
			mode?: "file" | "path";
			scope?: "tracked" | "all";
		};
	}>("/api/files", async (request, reply) => {
		if (request.query.cwd === undefined || request.query.cwd === "")
			return reply.code(400).send({ error: "cwd query parameter is required" });
		try {
			if (request.query.mode === "path") return await listPathSuggestions(request.query.cwd, request.query.q ?? "");
			return await listFileSuggestions(request.query.cwd, request.query.q ?? "", {
				kind: request.query.kind,
				scope: request.query.scope,
			});
		} catch (error) {
			return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	const packagedClientDist = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
	const clientDist =
		deps.clientDist ?? (existsSync(packagedClientDist) ? packagedClientDist : join(process.cwd(), "dist", "client"));
	if (clientDist !== false && existsSync(clientDist)) {
		await app.register(fastifyStatic, { root: clientDist });
		app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
	}

	return app;
}
