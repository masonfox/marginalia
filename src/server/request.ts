import {
	type AccessDeps,
	guardRequest,
	handleLogin,
	handleLogout,
	readCookie,
	SESSION_COOKIE,
	safeNext,
	validateSession,
} from "#/modules/access";
import { servesWeb } from "./config";
import type { AppContext } from "./context";

export type AppHandler = (request: Request) => Promise<Response> | Response;

/**
 * Front door for every request: role filtering, the access guard, and the
 * login/logout form posts, then the TanStack Start handler.
 */
export async function handleRequest(
	request: Request,
	ctx: Pick<AppContext, "config" | "access">,
	app: AppHandler,
): Promise<Response> {
	const url = new URL(request.url);
	// A dedicated worker process answers only the health check.
	if (!servesWeb(ctx.config) && url.pathname !== "/api/health") {
		return new Response("Not found", { status: 404 });
	}
	if (url.pathname === "/login") {
		const isRead = request.method === "GET" || request.method === "HEAD";
		if (isRead && !ctx.access.password.enabled) {
			return new Response(null, { status: 302, headers: { location: "/" } });
		}
		if (isRead && (await hasSession(request, ctx.access))) {
			const next = safeNext(url.searchParams.get("next"));
			return new Response(null, { status: 302, headers: { location: next } });
		}
		if (request.method === "POST") {
			// Only the cross-origin check applies before logging in.
			const rejected = await guardRequest(request, {
				...ctx.access,
				password: { enabled: false },
			});
			const socketAddress = (request as Request & { ip?: string }).ip;
			return rejected ?? handleLogin(request, ctx.access, socketAddress);
		}
	}
	const blocked = await guardRequest(request, ctx.access);
	if (blocked) return blocked;
	if (request.method === "POST" && url.pathname === "/logout") {
		return handleLogout(request, ctx.access);
	}
	return app(request);
}

async function hasSession(
	request: Request,
	access: AccessDeps,
): Promise<boolean> {
	return (
		(await validateSession(access.db, readCookie(request, SESSION_COOKIE))) !==
		null
	);
}
