import { readdir } from "node:fs/promises";
import { count } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { editions, handleUploadRequest } from "#/modules/library";
import { loadConfig } from "#/server/config";
import { handleRequest } from "#/server/request";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { silentLog, tempDataDir } from "../../../test/library";
import {
	type AccessDeps,
	createSession,
	LoginRateLimiter,
	type PasswordCheck,
	purgeExpiredSessions,
	sessions,
	setupPassword,
	validateSession,
} from ".";

let t: TestDb;
const PASSWORD = "correct horse battery staple";

beforeAll(async () => {
	t = await createTestDb();
});

const access = (
	password: PasswordCheck,
	over: Partial<AccessDeps> = {},
): AccessDeps => ({
	db: t.db,
	password,
	limiter: new LoginRateLimiter(),
	sessionDays: 30,
	trustProxy: false,
	publicUrl: undefined,
	...over,
});

const config = loadConfig({ DATABASE_URL: "postgres://unused" });
const pageHtml = { accept: "text/html,application/xhtml+xml" };

/** Stand-in for the TanStack handler: records calls, and runs real uploads. */
function appWith(dataDir: string) {
	const calls: string[] = [];
	const app = async (request: Request) => {
		const url = new URL(request.url);
		calls.push(`${request.method} ${url.pathname}`);
		if (url.pathname === "/api/uploads") {
			return handleUploadRequest(request, {
				db: t.db,
				dataDir,
				maxUploadMb: 10,
				enqueue: async () => "job",
				log: silentLog,
			});
		}
		return new Response("app", { status: 200 });
	};
	return { app, calls };
}

function loginRequest(
	password: string,
	next = "/",
	headers: Record<string, string> = {},
) {
	const body = new URLSearchParams({ password, next });
	return new Request("http://books.local/login", {
		method: "POST",
		body,
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			...headers,
		},
	});
}

const cookieFrom = (res: Response) =>
	res.headers.get("set-cookie")?.split(";")[0] ?? "";

describe("password setup", () => {
	it("verifies the correct password and rejects others", async () => {
		const check = await setupPassword(t.db, PASSWORD, silentLog);
		if (!check.enabled) throw new Error("expected enabled");
		expect(await check.verify(PASSWORD)).toBe(true);
		expect(await check.verify("wrong")).toBe(false);
		expect(await check.verify(`${PASSWORD} `)).toBe(false);
	});

	it("is disabled when no password is set", async () => {
		expect(await setupPassword(t.db, undefined, silentLog)).toEqual({
			enabled: false,
		});
	});

	it("keeps sessions across a restart with the same password, and ends them when it changes", async () => {
		await setupPassword(t.db, PASSWORD, silentLog);
		const { token } = await createSession(t.db, 30);
		await setupPassword(t.db, PASSWORD, silentLog); // restart, same password
		expect(await validateSession(t.db, token)).not.toBeNull();
		await setupPassword(t.db, "a brand new passphrase", silentLog); // restart, new password
		expect(await validateSession(t.db, token)).toBeNull();
		await setupPassword(t.db, PASSWORD, silentLog);
	});
});

describe("sessions", () => {
	it("creates, validates, and expires sessions", async () => {
		const start = new Date("2030-01-01T00:00:00Z");
		const { token, expiresAt } = await createSession(t.db, 30, start);
		expect(expiresAt.toISOString()).toBe("2030-01-31T00:00:00.000Z");
		expect(
			await validateSession(t.db, token, new Date("2030-01-30T23:59:59Z")),
		).not.toBeNull();
		expect(
			await validateSession(t.db, token, new Date("2030-01-31T00:00:01Z")),
		).toBeNull();
		expect(await validateSession(t.db, "forged-token")).toBeNull();
		expect(await validateSession(t.db, undefined)).toBeNull();
		expect(
			await purgeExpiredSessions(t.db, new Date("2030-02-01T00:00:00Z")),
		).toBeGreaterThanOrEqual(1);
	});

	it("stores only a hash of the token", async () => {
		const { token } = await createSession(t.db, 1);
		const rows = await t.db.select().from(sessions);
		for (const r of rows)
			expect(r.tokenHash.toString("base64url")).not.toBe(token);
	});
});

describe("login and request guard", () => {
	let deps: AccessDeps;
	let dataDir: string;

	beforeAll(async () => {
		deps = access(await setupPassword(t.db, PASSWORD, silentLog));
		dataDir = await tempDataDir();
	});

	it("redirects a logged-out page request to login with the original path", async () => {
		const { app, calls } = appWith(dataDir);
		const res = await handleRequest(
			new Request("http://books.local/p/abc:v1:2.3?ctx=1", {
				headers: pageHtml,
			}),
			{ config, access: deps },
			app,
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe(
			`/login?next=${encodeURIComponent("/p/abc:v1:2.3?ctx=1")}`,
		);
		expect(calls).toEqual([]);
	});

	it("logs in, lands on the requested page, and the session opens it", async () => {
		const { app, calls } = appWith(dataDir);
		const login = await handleRequest(
			loginRequest(PASSWORD, "/p/abc:v1:2.3"),
			{ config, access: deps },
			app,
		);
		expect(login.status).toBe(303);
		expect(login.headers.get("location")).toBe("/p/abc:v1:2.3");
		const setCookie = login.headers.get("set-cookie") ?? "";
		expect(setCookie).toMatch(
			/^marginalia_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/,
		);

		const page = await handleRequest(
			new Request("http://books.local/p/abc:v1:2.3", {
				headers: { ...pageHtml, cookie: cookieFrom(login) },
			}),
			{ config, access: deps },
			app,
		);
		expect(page.status).toBe(200);
		expect(calls).toEqual(["GET /p/abc:v1:2.3"]);

		const logout = await handleRequest(
			new Request("http://books.local/logout", {
				method: "POST",
				headers: { cookie: cookieFrom(login) },
			}),
			{ config, access: deps },
			app,
		);
		expect(logout.headers.get("location")).toBe("/login");
		expect(logout.headers.get("set-cookie")).toMatch(/Max-Age=0/);
		const after = await handleRequest(
			new Request("http://books.local/", {
				headers: { ...pageHtml, cookie: cookieFrom(login) },
			}),
			{ config, access: deps },
			app,
		);
		expect(after.status).toBe(302);
	});

	it("shows a generic error and creates no session for a wrong password", async () => {
		const { app } = appWith(dataDir);
		const [before] = await t.db.select({ n: count() }).from(sessions);
		const res = await handleRequest(
			loginRequest("nope", "/books"),
			{ config, access: deps },
			app,
		);
		expect(res.headers.get("location")).toBe(
			`/login?error=incorrect&next=${encodeURIComponent("/books")}`,
		);
		expect(res.headers.get("set-cookie")).toBeNull();
		const [after] = await t.db.select({ n: count() }).from(sessions);
		expect(after?.n).toBe(before?.n);
	});

	it("rejects an unauthenticated upload with 401 and stores nothing", async () => {
		const { app, calls } = appWith(dataDir);
		const form = new FormData();
		form.set(
			"file",
			new Blob([new Uint8Array(await fixtures.epub3())]),
			"x.epub",
		);
		const res = await handleRequest(
			new Request("http://books.local/api/uploads", {
				method: "POST",
				body: form,
			}),
			{ config, access: deps },
			app,
		);
		expect(res.status).toBe(401);
		expect(calls).toEqual([]);
		const [n] = await t.db.select({ n: count() }).from(editions);
		expect(n?.n).toBe(0);
		expect(await readdir(dataDir)).toEqual([]);
	});

	it("rejects server function calls without a session", async () => {
		const { app } = appWith(dataDir);
		const res = await handleRequest(
			new Request("http://books.local/_serverFn/abc", { method: "POST" }),
			{ config, access: deps },
			app,
		);
		expect(res.status).toBe(401);
	});

	it("keeps the health check open", async () => {
		const { app, calls } = appWith(dataDir);
		const res = await handleRequest(
			new Request("http://books.local/api/health"),
			{ config, access: deps },
			app,
		);
		expect(res.status).toBe(200);
		expect(calls).toEqual(["GET /api/health"]);
	});

	it("sends an off-site next to the library instead", async () => {
		const { app } = appWith(dataDir);
		for (const next of [
			"//evil.example",
			"https://evil.example/x",
			"/\\evil.example",
		]) {
			const res = await handleRequest(
				loginRequest(PASSWORD, next),
				{ config, access: deps },
				app,
			);
			expect(res.headers.get("location")).toBe("/");
		}
	});

	it("rejects cross-origin state-changing requests, even with a session", async () => {
		const { app, calls } = appWith(dataDir);
		const login = await handleRequest(
			loginRequest(PASSWORD),
			{ config, access: deps },
			app,
		);
		const res = await handleRequest(
			new Request("http://books.local/_serverFn/rescan", {
				method: "POST",
				headers: { cookie: cookieFrom(login), origin: "https://evil.example" },
			}),
			{ config, access: deps },
			app,
		);
		expect(res.status).toBe(403);
		const crossLogin = await handleRequest(
			loginRequest(PASSWORD, "/", { origin: "https://evil.example" }),
			{ config, access: deps },
			app,
		);
		expect(crossLogin.status).toBe(403);
		const sameOrigin = await handleRequest(
			new Request("http://books.local/_serverFn/rescan", {
				method: "POST",
				headers: { cookie: cookieFrom(login), origin: "http://books.local" },
			}),
			{ config, access: deps },
			app,
		);
		expect(sameOrigin.status).toBe(200);
		expect(calls).toEqual(["POST /_serverFn/rescan"]);
	});

	it("marks the cookie Secure behind a trusted HTTPS proxy only", async () => {
		const { app } = appWith(dataDir);
		const proxied = {
			"x-forwarded-proto": "https",
			"x-forwarded-for": "198.51.100.4",
		};
		const trusted = await handleRequest(
			loginRequest(PASSWORD, "/", proxied),
			{ config, access: { ...deps, trustProxy: true } },
			app,
		);
		expect(trusted.headers.get("set-cookie")).toMatch(/; Secure$/);
		const untrusted = await handleRequest(
			loginRequest(PASSWORD, "/", proxied),
			{ config, access: deps },
			app,
		);
		expect(untrusted.headers.get("set-cookie")).not.toMatch(/Secure/);
		const publicHttps = await handleRequest(
			loginRequest(PASSWORD),
			{ config, access: { ...deps, publicUrl: "https://books.example.com" } },
			app,
		);
		expect(publicHttps.headers.get("set-cookie")).toMatch(/; Secure$/);
	});

	it("rejects the 11th attempt even with the correct password, but not other clients", async () => {
		const { app } = appWith(dataDir);
		const limited = {
			...deps,
			limiter: new LoginRateLimiter(),
			trustProxy: true,
		};
		const from = (ip: string) => ({ "x-forwarded-for": ip });
		for (let i = 0; i < 10; i++) {
			const res = await handleRequest(
				loginRequest("wrong", "/", from("203.0.113.9")),
				{ config, access: limited },
				app,
			);
			expect(res.headers.get("location")).toMatch(/error=incorrect/);
		}
		const eleventh = await handleRequest(
			loginRequest(PASSWORD, "/", from("203.0.113.9")),
			{ config, access: limited },
			app,
		);
		expect(eleventh.headers.get("location")).toMatch(/error=limited/);
		expect(eleventh.headers.get("set-cookie")).toBeNull();
		const other = await handleRequest(
			loginRequest(PASSWORD, "/", from("203.0.113.10")),
			{ config, access: limited },
			app,
		);
		expect(other.headers.get("location")).toBe("/");
		expect(other.headers.get("set-cookie")).toMatch(/^marginalia_session=/);
	});
});

describe("no password set", () => {
	it("lets every request through and sends /login to the library", async () => {
		const deps = access({ enabled: false });
		const { app, calls } = appWith(await tempDataDir());
		const page = await handleRequest(
			new Request("http://books.local/books/1", { headers: pageHtml }),
			{ config, access: deps },
			app,
		);
		expect(page.status).toBe(200);
		const api = await handleRequest(
			new Request("http://books.local/_serverFn/x", { method: "POST" }),
			{ config, access: deps },
			app,
		);
		expect(api.status).toBe(200);
		const login = await handleRequest(
			new Request("http://books.local/login", { headers: pageHtml }),
			{ config, access: deps },
			app,
		);
		expect(login.status).toBe(302);
		expect(login.headers.get("location")).toBe("/");
		expect(calls).toEqual(["GET /books/1", "POST /_serverFn/x"]);
	});
});
