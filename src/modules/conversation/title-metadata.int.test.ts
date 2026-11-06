import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureEdition } from "#/modules/library";
import {
	aiUsage,
	NO_USAGE,
	priceTable,
	recordUsage,
	totalOf,
	usageForConversation,
	usageForEdition,
} from "#/modules/usage";
import { createDb } from "#/server/db";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	appendMessage,
	createConversation,
	deleteConversation,
	renameConversation,
} from "./repository";
import { conversations } from "./schema";
import { claimTitle, finalizeTitle } from "./title";
import { readNamingMetadata } from "./title-metadata";

const must = <T>(value: T | null | undefined): T => {
	if (value == null) throw new Error("Expected fixture value");
	return value;
};
let t: TestDb;
let editionId: string;
beforeAll(async () => {
	t = await createTestDb();
	editionId = (await ensureEdition(t.db, "title-usage-book", "Book")).edition
		.id;
});
const prices = priceTable({ known: { input: 1, output: 2 } });
const create = async () => {
	const { id } = await createConversation(t.db, { editionIds: [editionId] });
	await appendMessage(t.db, {
		conversationId: id,
		role: "user",
		parts: [{ type: "text", text: "Question" }],
		namingSelection: { provider: "openai", model: "known" },
	});
	return id;
};
const finalize = async (id: string, model = "known") => {
	const claim = await claimTitle(t.db, id);
	if (!claim) throw new Error("Missing claim");
	await finalizeTitle(t.db, claim, {
		title: "A Recognizable Question Subject",
		usage: { ...NO_USAGE, inputTokens: 100, outputTokens: 10 },
		steps: 1,
		complete: true,
		provider: "openai",
		model,
	});
};
describe("naming accounting and bounded metadata", () => {
	it("adds naming and failed reply attempts once without changing reply figures or missing count", async () => {
		const id = await create();
		const reply = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [],
			finishReason: "stop",
		});
		await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [],
		});
		await recordUsage(t.db, {
			...NO_USAGE,
			purpose: "conversation",
			conversationId: id,
			messageId: reply.id,
			provider: "openai",
			model: "known",
			inputTokens: 20,
			outputTokens: 5,
			steps: 1,
			complete: true,
		});
		await recordUsage(t.db, {
			...NO_USAGE,
			purpose: "conversation",
			conversationId: id,
			messageId: null,
			provider: "openai",
			model: "known",
			inputTokens: 5,
			outputTokens: 2,
			steps: 1,
			complete: false,
		});
		const before = await usageForConversation(t.db, id);
		await finalize(id);
		const after = await usageForConversation(t.db, id);
		expect(after.byMessage).toEqual(before.byMessage);
		expect(after.missing).toBe(1);
		expect(after.missing).toBe(before.missing);
		expect(totalOf(after, prices)).toMatchObject({
			inputTokens: 125,
			outputTokens: 17,
		});
		expect(after.naming).toMatchObject({
			missing: false,
			unknown: false,
			incomplete: false,
		});
		expect(after.naming?.rows).toHaveLength(1);
		expect(await usageForEdition(t.db, editionId)).toEqual([]);
		const metadata = await readNamingMetadata(t.db, [id], prices);
		expect(metadata[0]?.usageTotal).toEqual(totalOf(after, prices));
		expect(metadata[0]?.namingUsage).toEqual(after.naming);
	});
	it("isolates reply attribution and missing-reply joins by purpose even for legacy malformed rows", async () => {
		const id = await create();
		const reply = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [],
		});
		// Existing purpose values are text; unrelated message-linked rows cannot count as replies.
		await recordUsage(t.db, {
			...NO_USAGE,
			purpose: "preprocess",
			conversationId: id,
			editionId,
			messageId: reply.id,
			provider: "openai",
			model: "known",
			inputTokens: 10,
			outputTokens: 2,
			steps: 1,
			complete: true,
		});
		const usage = await usageForConversation(t.db, id);
		expect(usage.byMessage).toEqual({});
		expect(usage.missing).toBe(1);
	});
	it("unknown prices suppress combined estimates, missing or incomplete calls stay visible", async () => {
		const id = await create();
		await finalize(id, "unknown-model");
		expect(
			totalOf(await usageForConversation(t.db, id), prices).estimatedCost,
		).toBeNull();
		const interrupted = await create();
		const claim = must(await claimTitle(t.db, interrupted));
		await finalizeTitle(t.db, claim, {
			title: null,
			usage: { ...NO_USAGE, inputTokens: 12 },
			steps: 1,
			complete: false,
			provider: "openai",
			model: "known",
		});
		const usage = await usageForConversation(t.db, interrupted);
		expect(usage.naming).toMatchObject({
			incomplete: true,
			unknown: true,
			missing: false,
		});
		expect(usage.naming?.rows[0]).toMatchObject({
			inputTokens: 12,
			outputTokens: null,
		});
		expect(totalOf(usage, prices).estimatedCost).toBeNull();
	});
	it("bounds metadata reads, returns state/deadlines/revision and omits deleted ids", async () => {
		const id = await create();
		const gone = await create();
		await deleteConversation(t.db, gone);
		await expect(
			readNamingMetadata(t.db, Array(101).fill(id), prices),
		).rejects.toThrow("100");
		await expect(readNamingMetadata(t.db, [], prices)).rejects.toThrow();
		const [metadata] = await readNamingMetadata(t.db, [id, gone], prices);
		expect(metadata).toMatchObject({
			id,
			naming: { state: "pending", locked: false, revision: 1 },
		});
		expect(metadata?.naming.expiresAt).toBeInstanceOf(Date);
		expect(metadata?.naming.deadline).toBeNull();
		await t.db
			.update(conversations)
			.set({ namingExpiresAt: new Date(0) })
			.where(eq(conversations.id, id));
		expect(
			(await readNamingMetadata(t.db, [id], prices))[0]?.naming.state,
		).toBe("failed");
	});
	it("manual supersession keeps reported counts and stale attempts cannot change title or accounting", async () => {
		const id = await create();
		const claim = must(await claimTitle(t.db, id));
		await renameConversation(t.db, id, "Manual");
		const outcome = {
			title: "Generated",
			usage: { ...NO_USAGE, inputTokens: 10, outputTokens: 3 },
			steps: 1,
			complete: true,
			provider: "openai",
			model: "known",
		};
		await finalizeTitle(
			t.db,
			{ ...claim, namingAttemptId: "00000000-0000-4000-8000-000000000000" },
			outcome,
		);
		expect(
			await t.db.select().from(aiUsage).where(eq(aiUsage.conversationId, id)),
		).toHaveLength(0);
		await finalizeTitle(t.db, claim, outcome);
		expect((await readNamingMetadata(t.db, [id], prices))[0]).toMatchObject({
			title: "Manual",
			namingUsage: { rows: [{ inputTokens: 10, outputTokens: 3 }] },
		});
	});
	it("simultaneous delete/accounting races never create orphans or throw foreign-key errors", async () => {
		for (let i = 0; i < 5; i++) {
			const id = await create();
			const claim = must(await claimTitle(t.db, id));
			await Promise.all([
				deleteConversation(t.db, id),
				finalizeTitle(t.db, claim, {
					title: "Generated",
					usage: NO_USAGE,
					steps: 0,
					complete: false,
					provider: "openai",
					model: "known",
				}),
			]);
			expect(
				await t.db
					.select()
					.from(aiUsage)
					.where(
						and(
							eq(aiUsage.conversationId, id),
							eq(aiUsage.purpose, "conversation-title"),
						),
					),
			).toHaveLength(0);
		}
	});
});

describe("metadata snapshot during concurrent finalization", () => {
	const outcome = {
		title: "A Recognizable Question Subject",
		usage: { ...NO_USAGE, inputTokens: 100, outputTokens: 10 },
		steps: 1,
		complete: true,
		provider: "openai",
		model: "known",
	};
	/**
	 * A reader whose first SELECT is held until `gate` settles; later reads pass.
	 * Holding the parent read while finalizeTitle commits is the schedule where
	 * separately issued reads could see terminal state without its accounting.
	 */
	const gatedReader = (gate: Promise<unknown>) => {
		const handle = createDb(t.url, 4);
		const query = handle.pool.query.bind(handle.pool) as (
			...args: unknown[]
		) => Promise<unknown>;
		let held = false;
		(handle.pool as unknown as { query: unknown }).query = (
			config: string | { text: string },
			...rest: unknown[]
		) => {
			const text = typeof config === "string" ? config : config.text;
			if (!held && /^s*select/i.test(text)) {
				held = true;
				return gate.then(() => query(config, ...rest));
			}
			return query(config, ...rest);
		};
		return handle;
	};
	it("a read before commit sees running without naming usage, and one held across commit sees both", async () => {
		const id = await create();
		const claim = must(await claimTitle(t.db, id));
		await recordUsage(t.db, {
			...NO_USAGE,
			purpose: "conversation",
			conversationId: id,
			messageId: null,
			provider: "openai",
			model: "known",
			inputTokens: 20,
			outputTokens: 5,
			steps: 1,
			complete: true,
		});
		const [before] = await readNamingMetadata(t.db, [id], prices);
		expect(before).toMatchObject({
			naming: { state: "running", revision: 2 },
			namingUsage: { rows: [], missing: false },
			usageTotal: { inputTokens: 20, outputTokens: 5 },
		});

		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const reader = gatedReader(gate);
		try {
			const read = readNamingMetadata(reader.db, [id], prices);
			// Give the reader time to issue (and hold) its first SELECT.
			await new Promise((r) => setTimeout(r, 50));
			await finalizeTitle(t.db, claim, outcome);
			release();
			const [after] = await read;
			expect(after?.naming.state).toBe("succeeded");
			expect(after?.naming.revision).toBe(3);
			expect(after?.namingUsage).toMatchObject({
				rows: [{ inputTokens: 100, outputTokens: 10, complete: true }],
				missing: false,
			});
			expect(after?.usageTotal).toMatchObject({
				inputTokens: 120,
				outputTokens: 15,
			});
			// Same figures as a fresh read after commit.
			expect((await readNamingMetadata(t.db, [id], prices))[0]).toEqual(after);
		} finally {
			await reader.pool.end();
		}
	});
});
