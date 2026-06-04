import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FileTreeEntry, FileTreeResponse } from "../../shared/apiTypes.ts";
import { resolveInsideWorkspace } from "./pathSafety.ts";

const MAX_ENTRIES = 1000;

export async function listWorkspaceTree(rootPath: string, path: string | undefined): Promise<FileTreeResponse> {
	const { target, relativePath } = await resolveInsideWorkspace(rootPath, path);
	const stat = await lstat(target);
	if (!stat.isDirectory()) throw new Error("Path is not a directory");

	const dirents = await readdir(target, { withFileTypes: true });
	const sorted = dirents.sort((a, b) => {
		if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	const selected = sorted.slice(0, MAX_ENTRIES);
	const entries = await Promise.all(
		selected.map(async (entry): Promise<FileTreeEntry> => {
			const absolute = join(target, entry.name);
			const childRelative = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
			const childStat = await lstat(absolute);
			const type: FileTreeEntry["type"] = entry.isDirectory()
				? "directory"
				: entry.isSymbolicLink()
					? "symlink"
					: "file";
			return {
				name: entry.name,
				path: childRelative,
				type,
				size: childStat.size,
				modifiedAt: childStat.mtime.toISOString(),
			};
		}),
	);

	return {
		path: relativePath,
		entries,
		scannedAt: new Date().toISOString(),
		truncated: sorted.length > selected.length,
	};
}
