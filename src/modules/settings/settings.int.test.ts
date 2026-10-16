import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAi } from "#/modules/ai";
import type { AiConfig } from "#/server/config";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	getAiDefaults,
	getAiStatus,
	resetChatDefault,
	resetPreprocessDefault,
	saveChatDefault,
	savePreprocessDefault,
} from ".";

let t: TestDb;

const ANT_KEY = "sk-ant-settings-secret";
const OAI_KEY = "sk-oai-settings-secret";
const LOCAL_URL = "http://llm.internal:11434/v1";

const claude = { provider: "anthropic", model: "claude-env" } as const;
const haiku = { provider: "anthropic", model: "claude-small" } as const;
const gpt = { provider: "openai", model: "gpt-saved" } as const;

function config(
	credentials: AiConfig["credentials"],
	envDefaults: AiConfig["envDefaults"] = {},
): AiConfig {
	return {
		credentials,
		envDefaults,
		maxSteps: 8,
		temperature: undefined,
		effort: undefined,
		promptCache: true,
		prices: {},
	};
}

/** Anthropic from the legacy variables, plus OpenAI and a local endpoint. */
const both = createAi(
	config(
		{
			anthropic: { apiKey: ANT_KEY, baseUrl: undefined },
			openai: { apiKey: OAI_KEY, baseUrl: "https://proxy.example/v1" },
			"openai-compatible": { apiKey: undefined, baseUrl: LOCAL_URL },
		},
		{ chat: claude },
	),
);

beforeAll(async () => {
	t = await createTestDb();
});

beforeEach(async () => {
	await t.pool.query("delete from ai_settings");
});

describe("AI defaults", () => {
	it("uses the environment defaults when nothing is saved", async () => {
		expect(await getAiDefaults(t.db, both)).toEqual({
			chat: { selection: claude, source: "env", available: true },
			// No AI_PREPROCESS_MODEL: preprocessing follows chat.
			preprocess: {
				selection: claude,
				source: "env",
				available: true,
				sameAsChat: true,
			},
		});

		const withPreprocess = createAi(
			config(
				{ anthropic: { apiKey: ANT_KEY, baseUrl: undefined } },
				{ chat: claude, preprocess: haiku },
			),
		);
		const d = await getAiDefaults(t.db, withPreprocess);
		expect(d.preprocess).toEqual({
			selection: haiku,
			source: "env",
			available: true,
			sameAsChat: false,
		});
	});

	it("has no default with credentials but no AI_PROVIDER", async () => {
		const ai = createAi(
			config({ anthropic: { apiKey: ANT_KEY, baseUrl: undefined } }),
		);
		const d = await getAiDefaults(t.db, ai);
		expect(d.chat).toEqual({
			selection: null,
			source: "none",
			available: false,
		});
		expect(d.preprocess.source).toBe("none");
		expect(d.preprocess.selection).toBeNull();
	});

	it("prefers a saved default over the environment", async () => {
		expect(await saveChatDefault(t.db, both, gpt)).toEqual({
			status: "ok",
			selection: gpt,
		});
		const d = await getAiDefaults(t.db, both);
		expect(d.chat).toEqual({
			selection: gpt,
			source: "settings",
			available: true,
		});

		await savePreprocessDefault(t.db, both, haiku);
		expect((await getAiDefaults(t.db, both)).preprocess).toEqual({
			selection: haiku,
			source: "settings",
			available: true,
			sameAsChat: false,
		});
	});

	it("resets each default to the environment on its own", async () => {
		await saveChatDefault(t.db, both, gpt);
		await savePreprocessDefault(t.db, both, haiku);

		await resetChatDefault(t.db);
		let d = await getAiDefaults(t.db, both);
		expect(d.chat).toEqual({
			selection: claude,
			source: "env",
			available: true,
		});
		expect(d.preprocess.selection).toEqual(haiku);

		await resetPreprocessDefault(t.db);
		d = await getAiDefaults(t.db, both);
		expect(d.preprocess).toMatchObject({
			selection: claude,
			source: "env",
			sameAsChat: true,
		});
	});

	it("follows a chat change when preprocessing is saved as same as chat", async () => {
		const ai = createAi(
			config(
				{
					anthropic: { apiKey: ANT_KEY, baseUrl: undefined },
					openai: { apiKey: OAI_KEY, baseUrl: undefined },
				},
				// An env preprocess model that the saved choice overrides.
				{ chat: claude, preprocess: haiku },
			),
		);
		await savePreprocessDefault(t.db, ai, "same-as-chat");
		let d = await getAiDefaults(t.db, ai);
		expect(d.preprocess).toEqual({
			selection: claude,
			source: "settings",
			available: true,
			sameAsChat: true,
		});

		await saveChatDefault(t.db, ai, gpt);
		d = await getAiDefaults(t.db, ai);
		expect(d.preprocess.selection).toEqual(gpt);
		expect(d.preprocess.sameAsChat).toBe(true);
	});

	it("keeps a saved default whose provider lost its credentials, as unavailable", async () => {
		await saveChatDefault(t.db, both, gpt);
		await savePreprocessDefault(t.db, both, gpt);
		const anthropicOnly = createAi(
			config(
				{ anthropic: { apiKey: ANT_KEY, baseUrl: undefined } },
				{ chat: claude },
			),
		);
		const d = await getAiDefaults(t.db, anthropicOnly);
		// Never silently replaced by the env default.
		expect(d.chat).toEqual({
			selection: gpt,
			source: "settings",
			available: false,
		});
		expect(d.preprocess).toMatchObject({ selection: gpt, available: false });
	});

	it("rejects a provider without credentials and stores nothing", async () => {
		const ai = createAi(
			config({ anthropic: { apiKey: ANT_KEY, baseUrl: undefined } }),
		);
		expect(await saveChatDefault(t.db, ai, gpt)).toEqual({
			status: "unavailable",
			provider: "openai",
		});
		expect(await savePreprocessDefault(t.db, ai, gpt)).toMatchObject({
			status: "unavailable",
		});
		const { rows } = await t.pool.query("select * from ai_settings");
		expect(rows).toEqual([]);
	});

	it("rejects a blank model id and trims a valid one", async () => {
		const blank = await saveChatDefault(t.db, both, {
			provider: "openai",
			model: "   ",
		});
		expect(blank.status).toBe("invalid");
		expect((await getAiDefaults(t.db, both)).chat.source).toBe("env");

		await saveChatDefault(t.db, both, { provider: "openai", model: " gpt-x " });
		expect((await getAiDefaults(t.db, both)).chat.selection).toEqual({
			provider: "openai",
			model: "gpt-x",
		});
	});

	it("keeps the settings table to one row", async () => {
		await saveChatDefault(t.db, both, gpt);
		await savePreprocessDefault(t.db, both, "same-as-chat");
		const { rows } = await t.pool.query("select id from ai_settings");
		expect(rows).toEqual([{ id: 1 }]);
		await expect(
			t.pool.query("insert into ai_settings (id) values (2)"),
		).rejects.toThrow();
	});
});

describe("AI status", () => {
	it("reports providers and defaults without keys or base URLs", async () => {
		await saveChatDefault(t.db, both, gpt);
		const status = await getAiStatus(t.db, both);
		expect(status).toEqual({
			enabled: true,
			providers: ["openai", "anthropic", "openai-compatible"],
			chat: { selection: gpt, source: "settings", available: true },
			preprocess: {
				selection: gpt,
				source: "env",
				available: true,
				sameAsChat: true,
			},
		});
		const json = JSON.stringify(status);
		for (const secret of [
			ANT_KEY,
			OAI_KEY,
			LOCAL_URL,
			"proxy.example",
			"apiKey",
			"baseUrl",
			"credentials",
		])
			expect(json).not.toContain(secret);
	});

	it("is disabled without credentials", async () => {
		expect(await getAiStatus(t.db, createAi(undefined))).toEqual({
			enabled: false,
			providers: [],
			chat: { selection: null, source: "none", available: false },
			preprocess: {
				selection: null,
				source: "none",
				available: false,
				sameAsChat: true,
			},
		});
	});
});
