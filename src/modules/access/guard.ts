import type { Database } from "#/server/db";
import type { PasswordCheck } from "./password";
import { clientAddress, type LoginRateLimiter } from "./rate-limit";
import {
	clearedSessionCookie,
	createSession,
	deleteSession,
	readCookie,
	SESSION_COOKIE,
	sessionCookie,
	validateSession,
} from "./sessions";

export interface AccessDeps {
	db: Database;
	password: PasswordCheck;
	limiter: LoginRateLimiter;
	sessionDays: number;
	trustProxy: boolean;
	publicUrl: string | undefined;
}

const PUBLIC_PATHS = new Set([
	"/login",
	"/api/health",
	"/favicon.ico",
	"/robots.txt",
]);
const PUBLIC_PREFIXES = ["/assets/", "/_build/"];
/** Vite's dev-server module paths; they do not exist in production builds. */
const DEV_PREFIXES = ["/@", "/src/", "/node_modules/", "/__"];

function isPublicPath(pathname: string): boolean {
	if (PUBLIC_PATHS.has(pathname)) return true;
	if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
	return (
		process.env.NODE_ENV !== "production" &&
		DEV_PREFIXES.some((p) => pathname.startsWith(p))
	);
}

function isDocumentRequest(request: Request, url: URL): boolean {
	if (request.method !== "GET" && request.method !== "HEAD") return false;
	if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn"))
		return false;
	if (request.headers.get("sec-fetch-dest") === "document") return true;
	return (request.headers.get("accept") ?? "").includes("text/html");
}

/** Only same-origin paths; anything else (other hosts, `//host`, `/\host`) becomes the library. */
export function safeNext(next: unknown): string {
	if (typeof next !== "string" || !next.startsWith("/")) return "/";
	if (next.startsWith("//") || next.startsWith("/\\")) return "/";
	if ([...next].some((c) => c.charCodeAt(0) < 0x20)) return "/";
	return next;
}

/** Whether the client reached us over HTTPS, directly or through a trusted proxy. */
export function isHttps(
	request: Request,
	deps: Pick<AccessDeps, "trustProxy" | "publicUrl">,
): boolean {
	if (deps.publicUrl?.startsWith("https://")) return true;
	if (deps.trustProxy) {
		const proto = request.headers
			.get("x-forwarded-proto")
			?.split(",")[0]
			?.trim();
		if (proto) return proto === "https";
	}
	return new URL(request.url).protocol === "https:";
}

function allowedHosts(
	request: Request,
	deps: Pick<AccessDeps, "trustProxy" | "publicUrl">,
) {
	const hosts = new Set<string>();
	const host = request.headers.get("host");
	if (host) hosts.add(host.toLowerCase());
	hosts.add(new URL(request.url).host.toLowerCase());
	if (deps.trustProxy) {
		const forwarded = request.headers
			.get("x-forwarded-host")
			?.split(",")[0]
			?.trim();
		if (forwarded) hosts.add(forwarded.toLowerCase());
	}
	if (deps.publicUrl) hosts.add(new URL(deps.publicUrl).host.toLowerCase());
	return hosts;
}

/** Rejects state-changing requests whose `Origin` names another host (CSRF). */
function crossOriginRejection(
	request: Request,
	deps: AccessDeps,
): Response | null {
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
	const origin = request.headers.get("origin");
	if (!origin) return null;
	let originHost: string;
	try {
		originHost = new URL(origin).host.toLowerCase();
	} catch {
		originHost = "";
	}
	if (originHost && allowedHosts(request, deps).has(originHost)) return null;
	return Response.json(
		{ error: "Cross-origin request rejected" },
		{ status: 403 },
	);
}

/**
 * Runs before every route, server function, and API endpoint. Returns a
 * response to send instead, or null to continue. With no password set, only
 * the cross-origin check applies.
 */
export async function guardRequest(
	request: Request,
	deps: AccessDeps,
): Promise<Response | null> {
	const rejected = crossOriginRejection(request, deps);
	if (rejected) return rejected;
	if (!deps.password.enabled) return null;
	const url = new URL(request.url);
	if (isPublicPath(url.pathname)) return null;
	if (await validateSession(deps.db, readCookie(request, SESSION_COOKIE)))
		return null;
	if (isDocumentRequest(request, url)) {
		const next = encodeURIComponent(url.pathname + url.search);
		return redirect(`/login?next=${next}`, 302);
	}
	return Response.json({ error: "Login required" }, { status: 401 });
}

/** Handles the login form post (works without client JavaScript). */
export async function handleLogin(
	request: Request,
	deps: AccessDeps,
	socketAddress: string | undefined,
): Promise<Response> {
	if (!deps.password.enabled) return redirect("/", 303);
	const form = await request.formData().catch(() => null);
	const next = safeNext(form?.get("next"));
	const password = form?.get("password");
	const back = (error: string) =>
		redirect(`/login?error=${error}&next=${encodeURIComponent(next)}`, 303);

	const client = clientAddress(request, socketAddress, deps.trustProxy);
	if (deps.limiter.isBlocked(client)) return back("limited");
	const ok =
		typeof password === "string" &&
		password.length > 0 &&
		password.length <= 1024 &&
		(await deps.password.verify(password));
	if (!ok) {
		deps.limiter.recordFailure(client);
		return back("incorrect");
	}

	const { token } = await createSession(deps.db, deps.sessionDays);
	const response = redirect(next, 303);
	response.headers.append(
		"set-cookie",
		sessionCookie(token, {
			secure: isHttps(request, deps),
			maxAgeSeconds: deps.sessionDays * 24 * 60 * 60,
		}),
	);
	return response;
}

/** Ends the current session. */
export async function handleLogout(
	request: Request,
	deps: AccessDeps,
): Promise<Response> {
	await deleteSession(deps.db, readCookie(request, SESSION_COOKIE));
	const response = redirect(deps.password.enabled ? "/login" : "/", 303);
	response.headers.append(
		"set-cookie",
		clearedSessionCookie(isHttps(request, deps)),
	);
	return response;
}

function redirect(location: string, status: 302 | 303): Response {
	return new Response(null, { status, headers: { location } });
}
