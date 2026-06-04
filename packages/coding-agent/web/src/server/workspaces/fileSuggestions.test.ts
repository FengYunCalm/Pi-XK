import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type FileSuggestionDependencies, listFileSuggestions } from "./fileSuggestions";

const temporaryRoots: string[] = [];

async function tempWorkspace(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-web-files-"));
	temporaryRoots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("file suggestions", () => {
	it("uses tracked git files for tracked-scope suggestions", async () => {
		const calls: { file: string; args: string[] }[] = [];
		const deps: FileSuggestionDependencies = {
			execFile: (file, args) => {
				calls.push({ file, args });
				if (file === "git" && args.join(" ") === "ls-files")
					return Promise.resolve({ stdout: "src/app.ts\nREADME.md\n" });
				return Promise.reject(new Error(`unexpected command: ${file} ${args.join(" ")}`));
			},
		};

		await expect(listFileSuggestions("/repo", "", { scope: "tracked" }, deps)).resolves.toEqual([
			{ path: "src/", kind: "tracked" },
			{ path: "README.md", kind: "tracked" },
			{ path: "src/app.ts", kind: "tracked" },
		]);
		expect(calls).toEqual([{ file: "git", args: ["ls-files"] }]);
	});

	it("asks ripgrep for hidden and ignored files in all-file scope", async () => {
		const calls: { file: string; args: string[] }[] = [];
		const deps: FileSuggestionDependencies = {
			execFile: (file, args) => {
				calls.push({ file, args });
				return Promise.resolve({ stdout: "node_modules/pkg/index.js\nsrc/app.ts\n" });
			},
		};

		await expect(listFileSuggestions("/repo", "pkg", { scope: "all" }, deps)).resolves.toEqual([
			{ path: "node_modules/pkg/", kind: "other" },
			{ path: "node_modules/pkg/index.js", kind: "other" },
		]);
		expect(calls).toEqual([{ file: "rg", args: ["--files", "--hidden", "--no-ignore"] }]);
	});

	it("falls back to a bounded filesystem scan without directory exclusions when git and rg are unavailable", async () => {
		const root = await tempWorkspace();
		await mkdir(join(root, "src"), { recursive: true });
		await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
		await writeFile(join(root, "README.md"), "hello");
		await writeFile(join(root, "src", "app.ts"), "export {};\n");
		await writeFile(join(root, "node_modules", "pkg", "index.js"), "module.exports = {};\n");

		const deps: FileSuggestionDependencies = {
			execFile: (file) => Promise.reject(Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" })),
		};

		await expect(listFileSuggestions(root, "", { scope: "all" }, deps)).resolves.toEqual([
			{ path: "node_modules/", kind: "other" },
			{ path: "node_modules/pkg/", kind: "other" },
			{ path: "src/", kind: "other" },
			{ path: "node_modules/pkg/index.js", kind: "other" },
			{ path: "README.md", kind: "other" },
			{ path: "src/app.ts", kind: "other" },
		]);
	});
});
