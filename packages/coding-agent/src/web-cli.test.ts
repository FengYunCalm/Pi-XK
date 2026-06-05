import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePiWebCommand } from "./web-cli.ts";

describe("web CLI command resolution", () => {
	it("prefers the source Pi Web CLI in a local workspace", async () => {
		const packageDir = await fixturePackageDir({ source: true, dist: true });
		try {
			const command = resolvePiWebCommand(packageDir);

			expect(command.command).toBe(process.execPath);
			expect(command.args[0]).toContain("tsx");
			expect(command.args[1]).toBe(join(packageDir, "web", "src", "cli.ts"));
		} finally {
			await rm(packageDir, { recursive: true, force: true });
		}
	});

	it("uses the built Pi Web CLI when source is unavailable", async () => {
		const packageDir = await fixturePackageDir({ source: false, dist: true });
		try {
			const command = resolvePiWebCommand(packageDir);

			expect(command.command).toBe(process.execPath);
			expect(command.args).toEqual([join(packageDir, "dist", "web", "cli.js")]);
		} finally {
			await rm(packageDir, { recursive: true, force: true });
		}
	});
});

async function fixturePackageDir(options: { source: boolean; dist: boolean }): Promise<string> {
	const packageDir = await mkdtemp(join(tmpdir(), "pi-web-cli-"));
	if (options.source) {
		const sourcePath = join(packageDir, "web", "src", "cli.ts");
		await mkdir(join(packageDir, "web", "src"), { recursive: true });
		await writeFile(sourcePath, "export {};\n");
	}
	if (options.dist) {
		const distPath = join(packageDir, "dist", "web", "cli.js");
		await mkdir(join(packageDir, "dist", "web"), { recursive: true });
		await writeFile(distPath, "export {};\n");
	}
	return packageDir;
}
