import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { clearModelListCache } from "#/modules/ai";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	credentialsInputSchema,
	listProviderCredentials,
	loadCredentials,
	removeProviderCredentials,
	saveProviderCredentials,
} from ".";

let t: TestDb;
const secret = Buffer.alloc(32, 7).toString("base64"),
	key = "provider-private-key-1298";
beforeAll(async () => {
	t = await createTestDb();
});
beforeEach(async () => {
	await t.pool.query("delete from ai_credentials");
	clearModelListCache();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ data: [], models: [] })),
	);
});
afterEach(() => vi.unstubAllGlobals());
describe("provider credentials", () => {
	it.each([
		"openai",
		"anthropic",
		"google",
		"openai-compatible",
	] as const)("saves encrypted %s credentials with safe read and write results", async (provider) => {
		const result = await saveProviderCredentials(t.db, secret, {
			provider,
			apiKey: key,
			baseUrl: "https://provider.test/v1/",
		});
		expect(result.status).toBe("ok");
		expect(JSON.stringify(result)).not.toContain(key);
		const list = await listProviderCredentials(t.db, secret);
		const row = list.find((r) => r.provider === provider);
		expect(row).toMatchObject({
			configured: true,
			apiKeyHint: "1298",
			baseUrl: "https://provider.test/v1",
			unreadable: false,
		});
		expect(JSON.stringify(list)).not.toContain(key);
		const stored = await t.pool.query("select * from ai_credentials");
		expect(JSON.stringify(stored.rows)).not.toContain(key);
		expect((await loadCredentials(t.db, secret))[provider]?.apiKey).toBe(key);
	});
	it("requires hosted keys and a local URL but allows a keyless local endpoint", async () => {
		expect(
			(await saveProviderCredentials(t.db, secret, { provider: "openai" }))
				.status,
		).toBe("invalid");
		expect(
			(
				await saveProviderCredentials(t.db, secret, {
					provider: "openai-compatible",
				})
			).status,
		).toBe("invalid");
		expect(
			(
				await saveProviderCredentials(t.db, secret, {
					provider: "openai-compatible",
					baseUrl: "http://localhost:11434/v1",
				})
			).status,
		).toBe("ok");
		expect((await loadCredentials(t.db, secret))["openai-compatible"]).toEqual({
			apiKey: undefined,
			baseUrl: "http://localhost:11434/v1",
		});
	});
	it("keeps omitted keys and requires re-entry for any base URL change", async () => {
		await saveProviderCredentials(t.db, secret, {
			provider: "openai",
			apiKey: key,
		});
		expect(
			(await saveProviderCredentials(t.db, secret, { provider: "openai" }))
				.status,
		).toBe("ok");
		expect(
			(
				await saveProviderCredentials(t.db, secret, {
					provider: "openai",
					baseUrl: "https://other.test/v1",
				})
			).status,
		).toBe("invalid");
		expect(
			(
				await saveProviderCredentials(t.db, secret, {
					provider: "openai",
					baseUrl: "https://other.test/v1",
					apiKey: key,
				})
			).status,
		).toBe("ok");
		expect(
			(
				await saveProviderCredentials(t.db, secret, {
					provider: "openai",
					baseUrl: null,
				})
			).status,
		).toBe("invalid");
	});
	it.each([
		401, 403,
	])("refuses HTTP %s even with skipCheck and masks echoed keys", async (status) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(key, { status })),
		);
		const result = await saveProviderCredentials(t.db, secret, {
			provider: "openai",
			apiKey: key,
			skipCheck: true,
		});
		expect(result).toMatchObject({ status: "check_failed", canSkip: false });
		expect(JSON.stringify(result)).not.toContain(key);
		expect(await loadCredentials(t.db, secret)).toEqual({});
	});
	it("requires save anyway after listing errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error(key);
			}),
		);
		const input = { provider: "openai", apiKey: key };
		const result = await saveProviderCredentials(t.db, secret, input);
		expect(result).toMatchObject({ status: "check_failed", canSkip: true });
		expect(JSON.stringify(result)).not.toContain(key);
		expect(await loadCredentials(t.db, secret)).toEqual({});
		expect(
			(
				await saveProviderCredentials(t.db, secret, {
					...input,
					skipCheck: true,
				})
			).status,
		).toBe("ok");
	});
	it("reports wrong secrets as unreadable and allows replacement", async () => {
		await saveProviderCredentials(t.db, secret, {
			provider: "openai",
			apiKey: key,
		});
		const other = Buffer.alloc(32, 8).toString("base64");
		expect(await loadCredentials(t.db, other)).toEqual({});
		expect((await listProviderCredentials(t.db, other))[0]).toMatchObject({
			configured: false,
			unreadable: true,
		});
		expect(
			(await saveProviderCredentials(t.db, other, { provider: "openai" }))
				.status,
		).toBe("invalid");
		expect(
			(
				await saveProviderCredentials(t.db, other, {
					provider: "openai",
					apiKey: "new-key-5678",
				})
			).status,
		).toBe("ok");
		await removeProviderCredentials(t.db, "openai");
		expect(await loadCredentials(t.db, other)).toEqual({});
	});
	it.each([
		"https://user:pass@host/v1",
		"https://host/v1?key=x",
		"https://host/#x",
		"ftp://host/v1",
		"relative",
	])("rejects unsafe URL %s", (baseUrl) => {
		expect(
			credentialsInputSchema.safeParse({
				provider: "openai",
				apiKey: key,
				baseUrl,
			}).success,
		).toBe(false);
	});
	it.each([
		"",
		"has spaces",
		"has\ncontrol",
		"x".repeat(501),
	])("rejects malformed keys", (apiKey) => {
		expect(
			credentialsInputSchema.safeParse({ provider: "openai", apiKey }).success,
		).toBe(false);
	});
});
