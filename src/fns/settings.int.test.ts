import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createSession,
	LoginRateLimiter,
	setupPassword,
} from "#/modules/access";
import { loadConfig } from "#/server/config";
import { type AppContext, setAppContext } from "#/server/context";
import { handleRequest } from "#/server/request";
import { createTestDb, type TestDb } from "../../test/db";

// Exercise the real function handlers inside the real HTTP access boundary.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const builder = {
			validator: (_schema: unknown) => builder,
			handler:
				(handler: (args: { data: unknown }) => unknown) =>
				(args?: { data: unknown }) =>
					handler(args ?? { data: undefined }),
		};
		return builder;
	},
}));

import {
	getDiscussionPromptFn,
	listProviderCredentialsFn,
	removeProviderCredentialsFn,
	resetDiscussionPromptFn,
	saveDiscussionPromptFn,
	saveProviderCredentialsFn,
} from "./settings";

let t: TestDb;
const config = loadConfig({
	DATABASE_URL: "postgres://unused",
	MARGINALIA_SECRET_KEY: Buffer.alloc(32).toString("base64"),
});
beforeAll(async () => {
	t = await createTestDb();
	setAppContext({ db: t.db, config } as AppContext);
});
afterEach(() => vi.unstubAllGlobals());
describe("credential server functions", () => {
	it("refuses logged-out function requests and returns no key when authorized", async () => {
		const password = await setupPassword(t.db, "test-password", {
			info() {},
			warn() {},
		} as never);
		const access = {
			db: t.db,
			password,
			limiter: new LoginRateLimiter(),
			sessionDays: 30,
			trustProxy: false,
			publicUrl: undefined,
		};
		const key = "private-server-function-key";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [] })),
		);
		const calls = [
			() =>
				saveProviderCredentialsFn({
					data: { provider: "openai", apiKey: key },
				}),
			() => listProviderCredentialsFn(),
			() => removeProviderCredentialsFn({ data: { provider: "openai" } }),
		];
		const session = await createSession(t.db, 30);
		for (const action of calls) {
			const handler = vi.fn(async () => Response.json(await action()));
			const denied = await handleRequest(
				new Request("http://books.local/_serverFn/credentials", {
					method: "POST",
				}),
				{ config, access },
				handler,
			);
			expect(denied.status).toBe(401);
			expect(handler).not.toHaveBeenCalled();
			expect(await denied.text()).not.toContain(key);
			const response = await handleRequest(
				new Request("http://books.local/_serverFn/credentials", {
					method: "POST",
					headers: { cookie: `marginalia_session=${session.token}` },
				}),
				{ config, access },
				handler,
			);
			expect(response.status).toBe(200);
			expect(await response.text()).not.toContain(key);
		}
	});
});

describe("discussion prompt server access", () => {
	it("protects reads, saves and resets and leaves the override unchanged on denied writes", async () => {
		const password = await setupPassword(t.db, "test-password", {
			info() {},
			warn() {},
		} as never);
		const access = {
			db: t.db,
			password,
			limiter: new LoginRateLimiter(),
			sessionDays: 30,
			trustProxy: false,
			publicUrl: undefined,
		};
		const session = await createSession(t.db, 30);
		const request = (authorized: boolean) =>
			new Request("http://books.local/_serverFn/prompt", {
				method: "POST",
				headers: authorized
					? { cookie: `marginalia_session=${session.token}` }
					: {},
			});
		await saveDiscussionPromptFn({ data: "saved policy" });
		for (const action of [
			() => getDiscussionPromptFn(),
			() => saveDiscussionPromptFn({ data: "unauthorized" }),
			() => resetDiscussionPromptFn(),
		]) {
			const handler = vi.fn(async () => Response.json(await action()));
			expect(
				(await handleRequest(request(false), { config, access }, handler))
					.status,
			).toBe(401);
			expect(handler).not.toHaveBeenCalled();
			expect((await getDiscussionPromptFn()).text).toBe("saved policy");
		}
		const handler = async () =>
			Response.json(await saveDiscussionPromptFn({ data: "  " }));
		const invalid = await handleRequest(
			request(true),
			{ config, access },
			handler,
		);
		expect((await invalid.json()).error).toBeTruthy();
		expect((await getDiscussionPromptFn()).text).toBe("saved policy");
		const cleared = await handleRequest(
			request(true),
			{ config, access },
			async () => Response.json(await resetDiscussionPromptFn()),
		);
		expect((await cleared.json()).mode).toBe("default");
	});
});
