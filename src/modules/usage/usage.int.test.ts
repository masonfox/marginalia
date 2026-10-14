import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	appendMessage,
	createConversation,
	messages,
} from "#/modules/conversation";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { ingestBook, tempDataDir } from "../../../test/library";
import {
	aiUsage,
	type NewUsage,
	priceTable,
	recordUsage,
	totalOf,
	usageForConversation,
} from ".";

let t: TestDb;
let editionId: string;

beforeAll(async () => {
	t = await createTestDb();
	const book = await ingestBook(
		t.db,
		await tempDataDir(),
		await buildEpub({
			title: "Usage Book",
			language: "en",
			chapters: [{ href: "a.xhtml", title: "One", body: "<p>Text.</p>" }],
		}),
		"usage.epub",
	);
	editionId = book.id;
});

const row = (over: Partial<NewUsage>): NewUsage => ({
	purpose: "conversation",
	conversationId: null,
	messageId: null,
	provider: "anthropic",
	model: "claude-sonnet-5-5",
	inputTokens: 1000,
	outputTokens: 100,
	cacheReadTokens: 800,
	cacheWriteTokens: 0,
	reasoningTokens: null,
	steps: 2,
	complete: true,
	...over,
});

async function reply(conversationId: string, finishReason = "stop") {
	return appendMessage(t.db, {
		conversationId,
		role: "assistant",
		parts: [{ type: "text", text: "Reply." }],
		finishReason,
	});
}

describe("usageForConversation", () => {
	it("keeps a retried failure in the total and counts replies without usage", async () => {
		const { id } = await createConversation(t.db, { editionIds: [editionId] });
		await appendMessage(t.db, {
			conversationId: id,
			role: "user",
			parts: [{ type: "text", text: "Hi" }],
		});
		// A reply saved before usage recording existed.
		await reply(id);

		// A failed attempt with usage, then deleted by a retry.
		const failed = await reply(id, "error");
		await recordUsage(
			t.db,
			row({
				conversationId: id,
				messageId: failed.id,
				inputTokens: 500,
				outputTokens: 20,
				cacheReadTokens: null,
				cacheWriteTokens: null,
				steps: 1,
				complete: false,
			}),
		);
		await t.db.delete(messages).where(eq(messages.id, failed.id));
		const [kept] = await t.db
			.select()
			.from(aiUsage)
			.where(eq(aiUsage.conversationId, id));
		expect(kept?.messageId).toBeNull();

		const good = await reply(id);
		await recordUsage(t.db, row({ conversationId: id, messageId: good.id }));

		const usage = await usageForConversation(t.db, id);
		expect(Object.keys(usage.byMessage)).toEqual([good.id]);
		expect(usage.byMessage[good.id]).toMatchObject({
			model: "claude-sonnet-5-5",
			inputTokens: 1000,
			cacheReadTokens: 800,
			steps: 2,
			complete: true,
		});
		expect(usage.missing).toBe(1);

		const total = totalOf(usage, priceTable());
		expect(total).toMatchObject({
			inputTokens: 1500,
			outputTokens: 120,
			cacheReadTokens: 800,
			cacheWriteTokens: 0,
			reasoningTokens: null,
			missing: 1,
		});
		// (200 + 500) uncached × $2 + 800 cached × $0.10 + 120 out × $10, per MTok.
		expect(total.estimatedCost).toBeCloseTo(
			(700 * 2 + 800 * 0.1 + 120 * 10) / 1e6,
		);
	});

	it("shows no cost when any model in the total is unpriced", async () => {
		const { id } = await createConversation(t.db, { editionIds: [editionId] });
		const a = await reply(id);
		const b = await reply(id);
		await recordUsage(t.db, row({ conversationId: id, messageId: a.id }));
		await recordUsage(
			t.db,
			row({ conversationId: id, messageId: b.id, model: "llama3.1" }),
		);
		const total = totalOf(await usageForConversation(t.db, id), priceTable());
		expect(total.inputTokens).toBe(2000);
		expect(total.estimatedCost).toBeNull();
	});

	it("treats a reply whose provider reported no tokens as having no usage", async () => {
		const { id } = await createConversation(t.db, { editionIds: [editionId] });
		const failed = await reply(id, "error");
		await recordUsage(
			t.db,
			row({
				conversationId: id,
				messageId: failed.id,
				inputTokens: null,
				outputTokens: null,
				cacheReadTokens: null,
				cacheWriteTokens: null,
				steps: 1,
				complete: false,
			}),
		);
		const usage = await usageForConversation(t.db, id);
		expect(usage.byMessage).toEqual({});
		expect(usage.missing).toBe(1);
	});

	it("is empty for a conversation with no replies", async () => {
		const { id } = await createConversation(t.db, { editionIds: [editionId] });
		const usage = await usageForConversation(t.db, id);
		expect(usage).toEqual({ byMessage: {}, byModel: [], missing: 0 });
		expect(totalOf(usage, priceTable()).estimatedCost).toBeNull();
	});
});
