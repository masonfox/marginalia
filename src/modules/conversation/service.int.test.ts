import { beforeAll, describe, expect, it } from "vitest";
import { createAi } from "#/modules/ai";
import { deleteEdition, ensureEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { silentLog, tempDataDir } from "../../../test/library";
import {
	appendMessage,
	createConversation,
	createConversationForEdition,
	deleteConversation,
	getConversation,
	listConversationsForEdition,
	pruneEmptyConversations,
	renameConversation,
} from ".";

let t: TestDb;
let readyId: string;

const SECRET = "sk-super-secret-key";

beforeAll(async () => {
	t = await createTestDb();
	const { edition } = await ensureEdition(t.db, "f00d", "Ready Book");
	await t.pool.query(
		"update editions set status = 'ready', parser_version = 1 where id = $1",
		[edition.id],
	);
	readyId = edition.id;
});

describe("conversation operations behind the server functions", () => {
	it("creates, lists, gets, renames, and deletes a conversation", async () => {
		const created = await createConversationForEdition(t.db, readyId, {
			kind: "whole",
		});
		if (!created || "error" in created)
			throw new Error("expected a conversation");
		expect(
			(await listConversationsForEdition(t.db, readyId)).map((c) => c.id),
		).toContain(created.id);

		await appendMessage(t.db, {
			conversationId: created.id,
			role: "user",
			parts: [{ type: "text", text: "hello" }],
		});
		const got = await getConversation(t.db, created.id);
		expect(got?.books.map((b) => b.title)).toEqual(["Ready Book"]);
		expect(got?.messages).toHaveLength(1);

		expect(await renameConversation(t.db, created.id, "  Renamed  ")).toBe(
			true,
		);
		expect((await getConversation(t.db, created.id))?.title).toBe("Renamed");
		expect(await renameConversation(t.db, created.id, "   ")).toBe(false);

		expect(await deleteConversation(t.db, created.id)).toBe(true);
		expect(await getConversation(t.db, created.id)).toBeNull();
	});

	it("does not start a conversation for a missing or unready book", async () => {
		expect(
			await createConversationForEdition(
				t.db,
				"00000000-0000-0000-0000-000000000000",
				{ kind: "whole" },
			),
		).toBeNull();
		const { edition } = await ensureEdition(t.db, "beef", "Unready");
		expect(
			await createConversationForEdition(t.db, edition.id, { kind: "whole" }),
		).toBeNull();
	});

	it("deletes a book's conversations along with it, leaving others", async () => {
		const { edition } = await ensureEdition(t.db, "cafe", "Doomed");
		const doomed = await createConversation(t.db, { editionIds: [edition.id] });
		const other = await createConversation(t.db, { editionIds: [readyId] });
		await deleteEdition(t.db, await tempDataDir(), edition.id, silentLog);
		await pruneEmptyConversations(t.db);
		expect(await getConversation(t.db, doomed.id)).toBeNull();
		expect(await getConversation(t.db, other.id)).not.toBeNull();
	});

	it("exposes the AI status without the key", () => {
		const ai = createAi({
			provider: "openai",
			model: "gpt-test",
			apiKey: SECRET,
			baseUrl: undefined,
			maxSteps: 8,
			temperature: undefined,
		});
		expect(ai.status).toEqual({
			enabled: true,
			provider: "openai",
			model: "gpt-test",
		});
		expect(JSON.stringify(ai.status)).not.toContain(SECRET);
		expect(createAi(undefined).status).toEqual({ enabled: false });
	});
});
