const storageKey = "piWebAccessToken";

export function piWebAccessToken(): string | undefined {
	const urlToken = tokenFromUrl();
	if (urlToken !== undefined) {
		window.sessionStorage.setItem(storageKey, urlToken);
		return urlToken;
	}
	const stored = window.sessionStorage.getItem(storageKey);
	return stored === null || stored === "" ? undefined : stored;
}

export function addPiWebAuthHeader(headers: Headers): void {
	const token = piWebAccessToken();
	if (token !== undefined) headers.set("x-pi-web-token", token);
}

export function withPiWebTokenQuery(url: string): string {
	const token = piWebAccessToken();
	if (token === undefined) return url;
	const parsed = new URL(url, window.location.href);
	parsed.searchParams.set("token", token);
	return parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
}

function tokenFromUrl(): string | undefined {
	const token = new URLSearchParams(window.location.search).get("token")?.trim();
	return token === undefined || token === "" ? undefined : token;
}
