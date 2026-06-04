import type { SessionStatus } from "../api";
import { ActivityController } from "./activityController";
import { AuthController } from "./authController";
import { FileExplorerController } from "./fileExplorerController";
import { GitController } from "./gitController";
import { ProjectController } from "./projectController";
import { SessionController } from "./sessionController";
import type { GetState, SetState, UpdateUrl } from "./types";
import { WorkspaceController } from "./workspaceController";

export interface AppControllers {
	sessions: SessionController;
	activity: ActivityController;
	auth: AuthController;
	workspaces: WorkspaceController;
	projects: ProjectController;
	files: FileExplorerController;
	git: GitController;
}

export interface AppControllerOptions {
	getState: GetState;
	setState: SetState;
	updateUrl: UpdateUrl;
}

export function createAppControllers(options: AppControllerOptions): AppControllers {
	const sessions = new SessionController(options.getState, options.setState, options.updateUrl);
	const activity = new ActivityController(options.getState, options.setState);
	const auth = new AuthController(options.getState, options.setState, (status: SessionStatus) => {
		sessions.applySessionStatus(status);
	});
	const workspaces = new WorkspaceController(options.getState, options.setState, options.updateUrl, sessions);
	const projects = new ProjectController(options.getState, options.setState, workspaces);
	const files = new FileExplorerController(options.getState, options.setState, options.updateUrl);
	const git = new GitController(options.getState, options.setState, options.updateUrl);
	return { sessions, activity, auth, workspaces, projects, files, git };
}
