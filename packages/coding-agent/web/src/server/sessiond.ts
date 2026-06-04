#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { sessiondSocketPath } from "../sessiond/config.ts";
import { registerWorkspaceActivityRoutes } from "./activity/workspaceActivityRoutes.ts";
import { WorkspaceActivityService } from "./activity/workspaceActivityService.ts";
import { getPiWebComponentStatus } from "./piWebStatus.ts";
import { SessionEventHub } from "./realtime/sessionEventHub.ts";
import { registerAuthRoutes } from "./sessions/authRoutes.ts";
import { AuthService } from "./sessions/authService.ts";
import { PiSessionService } from "./sessions/piSessionService.ts";
import { registerSessionRoutes } from "./sessions/sessionRoutes.ts";
import { registerTerminalRoutes } from "./terminals/terminalRoutes.ts";
import { TerminalService } from "./terminals/terminalService.ts";

const app = Fastify({ logger: true });
await app.register(fastifyWebsocket);

const eventHub = new SessionEventHub();
const workspaceActivity = new WorkspaceActivityService(eventHub);
const auth = new AuthService();
const sessions = new PiSessionService(eventHub, { modelRegistry: auth.modelRegistry, workspaceActivity });
auth.subscribe((change) => {
	sessions.applyAuthChange(change);
});
const terminals = new TerminalService(eventHub, workspaceActivity);
registerWorkspaceActivityRoutes(app, workspaceActivity);
registerAuthRoutes(app, auth);
registerSessionRoutes(app, sessions, eventHub);
registerTerminalRoutes(app, terminals);

app.get("/health", async () => ({
	ok: true,
	activeSessions: sessions.activeCount(),
	checkedAt: new Date().toISOString(),
	version: await getPiWebComponentStatus("sessiond"),
}));

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	app.log.info({ signal }, "shutting down session daemon");
	terminals.dispose();
	auth.dispose();
	await sessions.dispose();
	await app.close();
}

process.once("SIGINT", (signal) => {
	void shutdown(signal);
});
process.once("SIGTERM", (signal) => {
	void shutdown(signal);
});

const portValue = process.env["PI_WEB_SESSIOND_PORT"];
const port = portValue !== undefined && portValue !== "" ? Number(portValue) : undefined;
const host = process.env["PI_WEB_SESSIOND_HOST"] ?? "127.0.0.1";

if (port !== undefined) {
	await app.listen({ port, host });
} else {
	const path = sessiondSocketPath();
	await mkdir(dirname(path), { recursive: true });
	await rm(path, { force: true });
	await app.listen({ path });
	process.on("exit", () => void rm(path, { force: true }));
}
