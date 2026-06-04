import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { effectivePiWebConfig } from "../config.ts";
import { registerGitRoutes } from "./gitRoutes.ts";
import { PiWebPluginService } from "./piWebPluginService.ts";
import { getPiWebStatus, getPiWebVersionStatus } from "./piWebStatus.ts";
import { listDirectorySuggestions } from "./projects/directorySuggestions.ts";
import { ProjectService } from "./projects/projectService.ts";
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

export interface PiWebSecurityOptions {
	token?: string;
	allowedHosts?: string[] | true;
}

const tokenCookieName = "pi_web_token";

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
	const app = Fastify({ logger: deps.logger ?? true });
	installSecurity(app, deps.security === undefined ? securityFromConfig() : deps.security);
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

function securityFromConfig(): PiWebSecurityOptions | false {
	const { config } = effectivePiWebConfig();
	return config.token === undefined && config.allowedHosts === undefined
		? false
		: { token: config.token, allowedHosts: config.allowedHosts };
}

function installSecurity(app: FastifyInstance, security: PiWebSecurityOptions | false): void {
	if (security === false) return;
	const requiredToken = normalizeToken(security.token);
	const allowedHosts = security.allowedHosts;
	if (requiredToken === undefined && allowedHosts === undefined) return;

	app.addHook("onRequest", (request, reply, done) => {
		if (!hostAllowed(request, allowedHosts)) {
			reply.code(403).send({ error: "Host is not allowed" });
			return;
		}
		if (!originAllowed(request, allowedHosts)) {
			reply.code(403).send({ error: "Origin is not allowed" });
			return;
		}
		if (requiredToken !== undefined && authProtectedPath(request.url)) {
			const presentedToken = requestToken(request);
			if (presentedToken !== requiredToken) {
				reply.code(401).send({ error: "Pi Web access token required" });
				return;
			}
		}
		persistQueryTokenCookie(request, reply, requiredToken);
		done();
	});
}

function normalizeToken(token: string | undefined): string | undefined {
	const trimmed = token?.trim();
	return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function authProtectedPath(rawUrl: string): boolean {
	const path = pathFromUrl(rawUrl);
	return path.startsWith("/api/") || path === "/api" || path.startsWith("/pi-web-plugins/");
}

function persistQueryTokenCookie(request: FastifyRequest, reply: FastifyReply, requiredToken: string | undefined): void {
	if (requiredToken === undefined) return;
	if (queryToken(request.url) !== requiredToken) return;
	reply.header("set-cookie", `${tokenCookieName}=${encodeURIComponent(requiredToken)}; Path=/; HttpOnly; SameSite=Strict`);
}

function requestToken(request: FastifyRequest): string | undefined {
	return headerValue(request.headers["x-pi-web-token"]) ?? queryToken(request.url) ?? cookieValue(request.headers.cookie);
}

function queryToken(rawUrl: string): string | undefined {
	const token = new URL(rawUrl, "http://pi-web.local").searchParams.get("token") ?? undefined;
	return normalizeToken(token);
}

function cookieValue(cookieHeader: string | undefined): string | undefined {
	if (cookieHeader === undefined) return undefined;
	for (const part of cookieHeader.split(";")) {
		const [rawName, ...rawValue] = part.trim().split("=");
		if (rawName === tokenCookieName) return decodeURIComponent(rawValue.join("="));
	}
	return undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
	return typeof value === "string" ? normalizeToken(value) : undefined;
}

function hostAllowed(request: FastifyRequest, allowedHosts: string[] | true | undefined): boolean {
	if (allowedHosts === undefined || allowedHosts === true) return true;
	if (allowedHosts.length === 0) return true;
	const host = request.headers.host;
	if (host === undefined) return false;
	return allowedHosts.includes(host) || allowedHosts.includes(hostnameFromHost(host));
}

function originAllowed(request: FastifyRequest, allowedHosts: string[] | true | undefined): boolean {
	const origin = request.headers.origin;
	if (typeof origin !== "string" || origin === "") return true;
	if (allowedHosts === true) return true;
	const requestHost = request.headers.host;
	if (requestHost !== undefined && urlHost(origin) === requestHost) return true;
	if (allowedHosts === undefined || allowedHosts.length === 0) return false;
	const originHost = urlHost(origin);
	if (originHost === undefined) return false;
	return allowedHosts.includes(originHost) || allowedHosts.includes(hostnameFromHost(originHost));
}

function urlHost(url: string): string | undefined {
	try {
		return new URL(url).host;
	} catch {
		return undefined;
	}
}

function pathFromUrl(rawUrl: string): string {
	return new URL(rawUrl, "http://pi-web.local").pathname;
}

function hostnameFromHost(host: string): string {
	if (host.startsWith("[") && host.includes("]")) return host.slice(1, host.indexOf("]"));
	const colon = host.lastIndexOf(":");
	return colon === -1 ? host : host.slice(0, colon);
}
