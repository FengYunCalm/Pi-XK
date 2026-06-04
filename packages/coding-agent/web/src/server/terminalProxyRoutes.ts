import type { FastifyInstance, FastifyReply } from "fastify";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.ts";
import type { ProjectService } from "./projects/projectService.ts";
import { terminalSizeQuery } from "./terminals/terminalSize.ts";
import { bridgeSockets } from "./webSocketBridge.ts";
import { resolveWorkspaceContext } from "./workspaces/workspaceContext.ts";
import type { WorkspaceService } from "./workspaces/workspaceService.ts";

export function registerTerminalProxyRoutes(
	app: FastifyInstance,
	projects: ProjectService,
	workspaces: WorkspaceService,
	daemon = new SessionDaemonClient(),
): void {
	app.get<{ Params: { projectId: string; workspaceId: string } }>(
		"/api/projects/:projectId/workspaces/:workspaceId/terminals",
		async (request, reply) => {
			try {
				const context = await resolveWorkspaceContext(
					projects,
					workspaces,
					request.params.projectId,
					request.params.workspaceId,
				);
				return await proxyJson(
					daemon,
					"GET",
					`/terminals?cwd=${encodeURIComponent(context.root)}`,
					undefined,
					reply,
				);
			} catch (error) {
				requestFailed(reply, error);
				return undefined;
			}
		},
	);

	app.post<{
		Params: { projectId: string; workspaceId: string };
		Body: { name?: string; cols?: number; rows?: number };
	}>("/api/projects/:projectId/workspaces/:workspaceId/terminals", async (request, reply) => {
		try {
			const context = await resolveWorkspaceContext(
				projects,
				workspaces,
				request.params.projectId,
				request.params.workspaceId,
			);
			return await proxyJson(daemon, "POST", "/terminals", { ...request.body, cwd: context.root }, reply);
		} catch (error) {
			requestFailed(reply, error);
			return undefined;
		}
	});

	app.post<{ Params: { projectId: string; workspaceId: string; terminalId: string } }>(
		"/api/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId/continue",
		async (request, reply) => {
			try {
				await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
				return await proxyJson(
					daemon,
					"POST",
					`/terminals/${encodeURIComponent(request.params.terminalId)}/continue`,
					undefined,
					reply,
				);
			} catch (error) {
				requestFailed(reply, error);
				return undefined;
			}
		},
	);

	app.delete<{ Params: { projectId: string; workspaceId: string; terminalId: string } }>(
		"/api/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId",
		async (request, reply) => {
			try {
				await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
				return await proxyJson(
					daemon,
					"DELETE",
					`/terminals/${encodeURIComponent(request.params.terminalId)}`,
					undefined,
					reply,
				);
			} catch (error) {
				requestFailed(reply, error);
				return undefined;
			}
		},
	);

	app.post<{ Params: { projectId: string; workspaceId: string }; Body: TerminalCommandRunRequest }>(
		"/api/projects/:projectId/workspaces/:workspaceId/terminal-command-runs",
		async (request, reply) => {
			try {
				const context = await resolveWorkspaceContext(
					projects,
					workspaces,
					request.params.projectId,
					request.params.workspaceId,
				);
				return await proxyJson(
					daemon,
					"POST",
					"/terminal-command-runs",
					{
						origin: request.body.origin,
						projectId: request.params.projectId,
						workspaceId: request.params.workspaceId,
						cwd: context.root,
						title: request.body.title,
						command: request.body.command,
						metadata: request.body.metadata ?? {},
					},
					reply,
				);
			} catch (error) {
				requestFailed(reply, error);
				return undefined;
			}
		},
	);

	app.get<{ Querystring: TerminalCommandRunQuery }>("/api/terminal-command-runs", async (request, reply) => {
		try {
			return await proxyJson(
				daemon,
				"GET",
				`/terminal-command-runs${terminalCommandRunQuery(request.query)}`,
				undefined,
				reply,
			);
		} catch (error) {
			requestFailed(reply, error);
			return undefined;
		}
	});

	app.post<{ Params: { runId: string } }>("/api/terminal-command-runs/:runId/cancel", async (request, reply) => {
		try {
			return await proxyJson(
				daemon,
				"POST",
				`/terminal-command-runs/${encodeURIComponent(request.params.runId)}/cancel`,
				undefined,
				reply,
			);
		} catch (error) {
			requestFailed(reply, error);
			return undefined;
		}
	});

	app.get<{ Params: { runId: string } }>("/api/terminal-command-runs/:runId", async (request, reply) => {
		try {
			return await proxyJson(
				daemon,
				"GET",
				`/terminal-command-runs/${encodeURIComponent(request.params.runId)}`,
				undefined,
				reply,
			);
		} catch (error) {
			requestFailed(reply, error);
			return undefined;
		}
	});

	app.get<{
		Params: { projectId: string; workspaceId: string; terminalId: string };
		Querystring: { cols?: string; rows?: string };
	}>(
		"/api/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId/socket",
		{ websocket: true },
		async (socket, request) => {
			try {
				await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
				const sizeQuery = terminalSizeQuery(request.query.cols, request.query.rows);
				bridgeSockets(
					socket,
					daemon.connectWebSocket(`/terminals/${request.params.terminalId}/socket${sizeQuery}`),
				);
			} catch (error) {
				socket.send(
					JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }),
				);
				socket.close();
			}
		},
	);
}

interface TerminalCommandRunRequest {
	origin: string;
	title: string;
	command: string;
	metadata?: Record<string, string>;
}

interface TerminalCommandRunQuery {
	projectId?: string;
	workspaceId?: string;
	terminalId?: string;
	statuses?: string;
	metadata?: string;
}

function terminalCommandRunQuery(filter: TerminalCommandRunQuery): string {
	const params = new URLSearchParams();
	if (filter.projectId !== undefined) params.set("projectId", filter.projectId);
	if (filter.workspaceId !== undefined) params.set("workspaceId", filter.workspaceId);
	if (filter.terminalId !== undefined) params.set("terminalId", filter.terminalId);
	if (filter.statuses !== undefined) params.set("statuses", filter.statuses);
	if (filter.metadata !== undefined) params.set("metadata", filter.metadata);
	const query = params.toString();
	return query === "" ? "" : `?${query}`;
}

async function proxyJson(
	daemon: SessionDaemonClient,
	method: string,
	path: string,
	body: unknown,
	reply: FastifyReply,
): Promise<unknown> {
	const upstream = await daemon.request(method, path, body);
	reply.code(upstream.statusCode);
	const contentType = upstream.headers["content-type"];
	if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
	const value: unknown = upstream.body !== "" ? JSON.parse(upstream.body) : undefined;
	return value;
}

function requestFailed(reply: FastifyReply, error: unknown): void {
	reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
}
