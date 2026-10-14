import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getReadingUnits,
	ingestEdition,
	passages,
	type ReadingUnit,
	type Rebase,
} from "#/modules/catalog";
import { type ParsedPassage, parseEpub } from "#/modules/epub";
import type { Executor } from "#/server/db";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import {
	addUploadedBook,
	ingestBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import {
	createConversation,
	createConversationForEdition,
	getConversation,
	listConversationsForEdition,
	rebaseScopes,
	type Scope,
	widenConversationScope,
} from ".";

let t: TestDb;
let bookId: string;
let units: ReadingUnit[];

beforeAll(async () => {
	t = await createTestDb();
	const book = await ingestBook(
		t.db,
		await tempDataDir(),
		await fixtures.nestedToc(),
		"nested.epub",
	);
	bookId = book.id;
	units = await getReadingUnits(t.db, bookId);
	expect(units).toHaveLength(3);
});

const unit = (i: number): Scope => ({
	kind: "unit",
	endPosition: (units[i] as ReadingUnit).endPosition,
});

async function start(scope: Scope) {
	const created = await createConversationForEdition(t.db, bookId, scope);
	if (!created || "error" in created)
		throw new Error("expected a conversation");
	return created.id;
}

const bookOf = async (id: string) =>
	(await getConversation(t.db, id))?.books[0];

describe("starting a conversation with a scope", () => {
	it("bounds the book at the chosen unit's end and records its label", async () => {
		const id = await start(unit(0));
		expect(await bookOf(id)).toMatchObject({
			maxPosition: units[0]?.endPosition,
			scopeLabel: "Part One › Chapter 1",
		});
		const listed = (await listConversationsForEdition(t.db, bookId)).find(
			(c) => c.id === id,
		);
		expect(listed?.scopeLabel).toBe("Part One › Chapter 1");
	});

	it("leaves a whole-book conversation unbounded", async () => {
		const id = await start({ kind: "whole" });
		expect(await bookOf(id)).toMatchObject({
			maxPosition: null,
			scopeLabel: null,
		});
	});

	it("rejects an end position that is not a current unit's end", async () => {
		const before = await listConversationsForEdition(t.db, bookId);
		expect(
			await createConversationForEdition(t.db, bookId, {
				kind: "unit",
				endPosition: (units[0]?.endPosition ?? 0) - 1,
			}),
		).toEqual({ error: "stale_scope" });
		expect(await listConversationsForEdition(t.db, bookId)).toHaveLength(
			before.length,
		);
	});

	it("shows conversations created without a scope as whole book", async () => {
		const { id } = await createConversation(t.db, { editionIds: [bookId] });
		expect(await bookOf(id)).toMatchObject({
			maxPosition: null,
			scopeLabel: null,
		});
	});
});

describe("widening a conversation's scope", () => {
	const widen = (conversationId: string, scope: Scope) =>
		widenConversationScope(t.db, {
			conversationId,
			editionId: bookId,
			scope,
		});

	it("moves the bound to a later unit", async () => {
		const id = await start(unit(0));
		expect(await widen(id, unit(2))).toEqual({ widened: true });
		expect(await bookOf(id)).toMatchObject({
			maxPosition: units[2]?.endPosition,
			scopeLabel: "Part Two › Chapter 3",
		});
	});

	it("removes the bound for whole book", async () => {
		const id = await start(unit(1));
		expect(await widen(id, { kind: "whole" })).toEqual({ widened: true });
		expect(await bookOf(id)).toMatchObject({
			maxPosition: null,
			scopeLabel: null,
		});
	});

	it("rejects narrowing and leaves the scope unchanged", async () => {
		const id = await start(unit(2));
		expect(await widen(id, unit(0))).toEqual({
			widened: false,
			reason: "not_wider",
		});
		expect(await bookOf(id)).toMatchObject({
			maxPosition: units[2]?.endPosition,
			scopeLabel: "Part Two › Chapter 3",
		});
	});

	it("rejects any unit for a whole-book conversation", async () => {
		const id = await start({ kind: "whole" });
		expect(await widen(id, unit(2))).toEqual({
			widened: false,
			reason: "not_wider",
		});
		expect(await widen(id, { kind: "whole" })).toEqual({
			widened: false,
			reason: "not_wider",
		});
		expect((await bookOf(id))?.maxPosition).toBeNull();
	});

	it("treats the same scope as a no-op", async () => {
		const id = await start(unit(1));
		expect(await widen(id, unit(1))).toEqual({
			widened: false,
			reason: "not_wider",
		});
		expect((await bookOf(id))?.scopeLabel).toBe("Part One › Chapter 2");
	});

	it("rejects a stale unit and an unknown conversation", async () => {
		const id = await start(unit(0));
		expect(await widen(id, { kind: "unit", endPosition: 99_999 })).toEqual({
			widened: false,
			reason: "stale_scope",
		});
		expect(
			await widen("00000000-0000-0000-0000-000000000000", unit(2)),
		).toEqual({ widened: false, reason: "not_found" });
	});
});

describe("scope across a reparse", () => {
	it("keeps a chapter bound on the same text and keeps its label", async () => {
		const bytes = await fixtures.nestedToc();
		const dataDir = await tempDataDir();
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			Buffer.concat([bytes, Buffer.from("rebase")]),
			"rebase.epub",
		);
		const v1 = await parseEpub(bytes);
		const deps = {
			db: t.db,
			dataDir,
			log: silentLog,
			onReplaced: (tx: Executor, c: { editionId: string; rebase: Rebase }) =>
				rebaseScopes(tx, c.editionId, c.rebase),
		};
		await ingestEdition({ ...deps, parse: async () => v1 }, sha256, {
			finalAttempt: true,
		});
		const [, second] = await getReadingUnits(t.db, edition.id);
		const created = await createConversationForEdition(t.db, edition.id, {
			kind: "unit",
			endPosition: second?.endPosition as number,
		});
		if (!created || "error" in created)
			throw new Error("expected a conversation");
		const textAt = async (position: number) => {
			const [row] = await t.db
				.select({ text: passages.text })
				.from(passages)
				.where(
					and(
						eq(passages.editionId, edition.id),
						eq(passages.position, position),
					),
				);
			return row?.text;
		};
		const before = await bookOf(created.id);
		const boundText = await textAt(before?.maxPosition as number);

		// v2 adds a passage to the first chapter, shifting every later position.
		const v2 = reshape(v1, 2, (ps, spine) =>
			spine === 1
				? [
						...ps,
						{
							...(ps[0] as ParsedPassage),
							kind: "paragraph",
							text: "Inserted.",
						},
					]
				: ps,
		);
		await ingestEdition(
			{ ...deps, parse: async () => v2, parserVersion: 2 },
			sha256,
			{ finalAttempt: true },
		);
		const after = await bookOf(created.id);
		expect(after?.maxPosition).toBe((before?.maxPosition as number) + 1);
		expect(await textAt(after?.maxPosition as number)).toBe(boundText);
		expect(after?.scopeLabel).toBe(before?.scopeLabel);
		expect(after?.scopeLabel).toBe("Part One › Chapter 2");
	});
});
