import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AiProviderName } from "#/server/config";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	clearChatDefault,
	clearPreprocessDefault,
	getAiDefaults,
	getAiStatus,
	saveChatDefault,
	savePreprocessDefault,
} from ".";

let t: TestDb;
let providers: AiProviderName[];
const ai = { available: async () => providers };
const gpt = { provider: "openai", model: "gpt-saved" } as const,
	claude = { provider: "anthropic", model: "claude-saved" } as const;
beforeAll(async () => {
	t = await createTestDb();
});
beforeEach(async () => {
	await t.pool.query("delete from ai_settings");
	providers = ["openai", "anthropic"];
});
describe("AI defaults", () => {
	it("starts without a chat default and preprocessing follows chat", async () => {
		expect(await getAiDefaults(t.db, ai)).toEqual({
			chat: { selection: null, available: false },
			preprocess: { selection: null, available: false, sameAsChat: true },
		});
	});
	it("saves defaults and follows chat changes", async () => {
		await saveChatDefault(t.db, ai, gpt);
		expect((await getAiDefaults(t.db, ai)).preprocess).toEqual({
			selection: gpt,
			available: true,
			sameAsChat: true,
		});
		await saveChatDefault(t.db, ai, claude);
		expect((await getAiDefaults(t.db, ai)).preprocess.selection).toEqual(
			claude,
		);
		await savePreprocessDefault(t.db, ai, gpt);
		expect((await getAiDefaults(t.db, ai)).preprocess).toEqual({
			selection: gpt,
			available: true,
			sameAsChat: false,
		});
	});
	it("clears each default independently", async () => {
		await saveChatDefault(t.db, ai, gpt);
		await savePreprocessDefault(t.db, ai, claude);
		await clearChatDefault(t.db);
		expect(await getAiDefaults(t.db, ai)).toEqual({
			chat: { selection: null, available: false },
			preprocess: { selection: claude, available: true, sameAsChat: false },
		});
		await saveChatDefault(t.db, ai, gpt);
		await clearPreprocessDefault(t.db);
		expect((await getAiDefaults(t.db, ai)).preprocess).toEqual({
			selection: gpt,
			available: true,
			sameAsChat: true,
		});
	});
	it("supports explicit same-as-chat", async () => {
		await saveChatDefault(t.db, ai, gpt);
		await savePreprocessDefault(t.db, ai, claude);
		await savePreprocessDefault(t.db, ai, "same-as-chat");
		expect((await getAiDefaults(t.db, ai)).preprocess).toEqual({
			selection: gpt,
			available: true,
			sameAsChat: true,
		});
	});
	it("keeps selections unavailable after provider removal", async () => {
		await saveChatDefault(t.db, ai, gpt);
		providers = ["anthropic"];
		expect((await getAiDefaults(t.db, ai)).chat).toEqual({
			selection: gpt,
			available: false,
		});
		expect(await saveChatDefault(t.db, ai, gpt)).toEqual({
			status: "unavailable",
			provider: "openai",
		});
	});
	it.each([
		"",
		"x".repeat(201),
		"has\ncontrol",
	])("rejects invalid model ids", async (model) => {
		expect(
			(await saveChatDefault(t.db, ai, { provider: "openai", model })).status,
		).toBe("invalid");
	});
	it("reports only provider names and selections, without source or credentials", async () => {
		await saveChatDefault(t.db, ai, gpt);
		const status = await getAiStatus(t.db, ai);
		expect(status).toMatchObject({
			enabled: true,
			providers: ["openai", "anthropic"],
		});
		expect(JSON.stringify(status)).not.toMatch(/source|apiKey|baseUrl/);
		providers = [];
		expect((await getAiStatus(t.db, ai)).enabled).toBe(false);
	});
});
