import { mkdir, realpath, stat } from "node:fs/promises";
import type { ProjectStore } from "../storage/projectStore.ts";
import type { Project } from "../types.ts";
import { expandUserPath } from "./directorySuggestions.ts";

export class ProjectService {
	private readonly store: ProjectStore;

	constructor(store: ProjectStore) {
		this.store = store;
	}

	list(): Promise<Project[]> {
		return this.store.list();
	}

	async add(input: { name?: string; path: string; create?: boolean }): Promise<Project> {
		const requestedPath = expandUserPath(input.path);
		if (input.create === true) await mkdir(requestedPath, { recursive: true });
		const resolved = await realpath(requestedPath);
		const s = await stat(resolved);
		if (!s.isDirectory()) throw new Error("Project path must be a directory");
		return this.store.add(input.name === undefined ? { path: resolved } : { name: input.name, path: resolved });
	}

	async close(id: string): Promise<void> {
		if (!(await this.store.remove(id))) throw new Error("Project not found");
	}

	async requireProject(id: string): Promise<Project> {
		const project = await this.store.get(id);
		if (!project) throw new Error("Project not found");
		return project;
	}
}
