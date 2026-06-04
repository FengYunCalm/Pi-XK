import type { FastifyInstance } from "fastify";
import type { WorkspaceActivityResponse } from "../../shared/apiTypes.ts";

export interface WorkspaceActivityRouteService {
	snapshot(): WorkspaceActivityResponse;
}

export function registerWorkspaceActivityRoutes(
	app: FastifyInstance,
	activity: WorkspaceActivityRouteService,
	prefix = "",
): void {
	app.get(`${prefix}/activity`, () => activity.snapshot());
}
