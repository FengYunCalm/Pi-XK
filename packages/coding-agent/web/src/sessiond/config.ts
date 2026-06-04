import { join } from "node:path";
import { piWebDataDir } from "../config.ts";

export function sessiondSocketPath(): string {
	return process.env["PI_WEB_SESSIOND_SOCKET"] ?? join(piWebDataDir(), "sessiond.sock");
}

export function sessiondHttpUrl(): string | undefined {
	return process.env["PI_WEB_SESSIOND_URL"];
}
