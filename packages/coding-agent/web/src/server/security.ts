import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { effectivePiWebConfig } from "../config.ts";

export interface PiWebSecurityOptions {
	token?: string;
	allowedHosts?: string[] | true;
}

const tokenCookieName = "pi_web_token";

export function piWebSecurityFromConfig(): PiWebSecurityOptions | false {
	const { config } = effectivePiWebConfig();
	return config.token === undefined && config.allowedHosts === undefined
		? false
		: { token: config.token, allowedHosts: config.allowedHosts };
}

export function installPiWebSecurity(app: FastifyInstance, security: PiWebSecurityOptions | false): void {
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
