import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteEdition, editions, ensureEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	linkByKey,
	manualLink,
	matchProviderBooks,
	type ProviderBook,
	progressLinks,
	progressProviders,
	progressUnmatched,
	unlink,
} from ".";

let t: TestDb;
const sha = () => randomBytes(32).toString("hex");

async function edition(
	title: string,
	identifiers: { scheme: string | null; value: string }[] = [],
) {
	const { edition } = await ensureEdition(t.db, sha(), title);
	await t.db
		.update(editions)
		.set({ identifiers })
		.where(eq(editions.id, edition.id));
	return edition.id;
}

function book(
	externalId: string,
	over: Partial<ProviderBook> = {},
): ProviderBook {
	return {
		externalId,
		isbns: [],
		ids: {},
		title: `Book ${externalId}`,
		reading: { state: "reading", fraction: 0.42 },
		...over,
	};
}

async function links() {
	const rows = await t.db.select().from(progressLinks);
	return rows
		.map((r) => ({
			editionId: r.editionId,
			kind: r.providerKind,
			externalId: r.externalId,
			matchedBy: r.matchedBy,
		}))
		.sort((a, b) => a.externalId.localeCompare(b.externalId));
}

async function unmatchedIds() {
	const rows = await t.db.select().from(progressUnmatched);
	return rows.map((r) => r.externalId).sort();
}

beforeAll(async () => {
	t = await createTestDb();
});
beforeEach(async () => {
	await t.pool.query("delete from progress_providers");
	await t.pool.query("delete from editions");
	await t.db.insert(progressProviders).values([
		{ kind: "hardcover", priority: 1 },
		{ kind: "bookorbit", priority: 2 },
	]);
});

describe("matching provider books (list mode)", () => {
	it("links by ISBN across ISBN-10 and ISBN-13 forms", async () => {
		const id = await edition("Zero", [{ scheme: "ISBN", value: "0000000000" }]);
		await edition("Other", [{ scheme: "ISBN", value: "9780306406157" }]);
		const hc = book("hc-1", { isbns: ["978-0-00-000000-2"] });

		const linked = await matchProviderBooks(t.db, "hardcover", [hc]);

		expect(linked).toEqual([{ editionId: id, book: hc, matchedBy: "auto" }]);
		expect(await links()).toEqual([
			{
				editionId: id,
				kind: "hardcover",
				externalId: "hc-1",
				matchedBy: "auto",
			},
		]);
		expect(await unmatchedIds()).toEqual([]);
	});

	it("reads ISBNs from prefixed and scheme-less identifiers", async () => {
		const a = await edition("Urn", [
			{ scheme: null, value: "urn:isbn:0-306-40615-2" },
		]);
		const b = await edition("Bare", [{ scheme: null, value: "080442957X" }]);
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("hc-a", { isbns: ["9780306406157"] }),
			book("hc-b", { isbns: ["978-0-8044-2957-3"] }),
		]);
		expect(linked.map((l) => [l.book.externalId, l.editionId])).toEqual([
			["hc-a", a],
			["hc-b", b],
		]);
	});

	it("links by Hardcover id when no ISBN matches", async () => {
		const id = await edition("Tagged", [
			{ scheme: "hardcover-id", value: "4242" },
		]);
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", {
				isbns: ["9780306406157"],
				ids: { "hardcover-id": "4242" },
			}),
		]);
		expect(linked.map((l) => l.editionId)).toEqual([id]);
	});

	it("prefers an ISBN match over a work-level id shared by two editions", async () => {
		const exact = await edition("Exact", [
			{ scheme: "ISBN", value: "9780306406157" },
			{ scheme: "hardcover-id", value: "4242" },
		]);
		await edition("Translation", [{ scheme: "hardcover-id", value: "4242" }]);
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", {
				isbns: ["9780306406157"],
				ids: { "hardcover-id": "4242" },
			}),
		]);
		expect(linked.map((l) => l.editionId)).toEqual([exact]);
	});

	it("lists an unmatched book being read", async () => {
		await edition("Unrelated", [{ scheme: "ISBN", value: "9780306406157" }]);
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", {
				title: "Elsewhere",
				authors: ["A. Writer"],
				isbns: ["978-0-8044-2957-3"],
				reading: {
					state: "reading",
					fraction: 0.3,
					observedAt: new Date("2026-11-01T10:00:00Z"),
				},
			}),
		]);
		expect(linked).toEqual([]);
		const rows = await t.db.select().from(progressUnmatched);
		expect(rows).toMatchObject([
			{
				providerKind: "hardcover",
				externalId: "hc-1",
				title: "Elsewhere",
				authors: ["A. Writer"],
				isbns: ["978-0-8044-2957-3"],
				reading: {
					state: "reading",
					fraction: 0.3,
					observedAt: "2026-11-01T10:00:00.000Z",
				},
			},
		]);
	});

	it("does not link an ambiguous match and lists it", async () => {
		await edition("One", [{ scheme: "ISBN", value: "9780306406157" }]);
		await edition("Two", [{ scheme: null, value: "isbn:0-306-40615-2" }]);
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", { isbns: ["9780306406157"] }),
		]);
		expect(linked).toEqual([]);
		expect(await links()).toEqual([]);
		expect(await unmatchedIds()).toEqual(["hc-1"]);
	});

	it("does not link two provider books to one edition", async () => {
		await edition("One", [{ scheme: "ISBN", value: "9780306406157" }]);
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", { isbns: ["9780306406157"] }),
			book("hc-2", { isbns: ["0306406152"] }),
		]);
		expect(linked).toEqual([]);
		expect(await unmatchedIds()).toEqual(["hc-1", "hc-2"]);
	});

	it("ignores unmatched books that are not being read", async () => {
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("done", { reading: { state: "finished" } }),
			book("todo", { reading: { state: "not-started" } }),
			book("dropped", { reading: { state: "abandoned" } }),
		]);
		expect(linked).toEqual([]);
		expect(await unmatchedIds()).toEqual([]);
	});

	it("links matched books whatever their reading state", async () => {
		const id = await edition("Done", [
			{ scheme: "ISBN", value: "9780306406157" },
		]);
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("done", {
				isbns: ["9780306406157"],
				reading: { state: "finished" },
			}),
		]);
		expect(linked.map((l) => l.editionId)).toEqual([id]);
	});

	it("keeps a manual link over a matching edition", async () => {
		const chosen = await edition("Chosen");
		await edition("Matching", [{ scheme: "ISBN", value: "9780306406157" }]);
		await manualLink(t.db, "hardcover", "hc-1", chosen);
		const hc = book("hc-1", { isbns: ["9780306406157"] });

		const linked = await matchProviderBooks(t.db, "hardcover", [hc]);

		expect(linked).toEqual([
			{ editionId: chosen, book: hc, matchedBy: "manual" },
		]);
		expect(await links()).toEqual([
			{
				editionId: chosen,
				kind: "hardcover",
				externalId: "hc-1",
				matchedBy: "manual",
			},
		]);
	});

	it("never auto-links another book to a manually linked edition", async () => {
		const id = await edition("Mine", [
			{ scheme: "ISBN", value: "9780306406157" },
		]);
		await manualLink(t.db, "hardcover", "hc-manual", id);
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("hc-manual"),
			book("hc-other", { isbns: ["9780306406157"] }),
		]);
		expect(linked.map((l) => [l.book.externalId, l.matchedBy])).toEqual([
			["hc-manual", "manual"],
		]);
		expect(await unmatchedIds()).toEqual(["hc-other"]);
	});

	it("refreshes the unmatched list and stale auto links on each run", async () => {
		const id = await edition("One", [
			{ scheme: "ISBN", value: "9780306406157" },
		]);
		await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", { isbns: ["9780306406157"] }),
			book("hc-2"),
		]);
		expect(await unmatchedIds()).toEqual(["hc-2"]);
		await t.db.insert(progressUnmatched).values({
			providerKind: "bookorbit",
			externalId: "other-kind",
			title: "Kept",
			reading: { state: "reading" },
		});

		// The edition loses its ISBN; hc-2 is finished now.
		await t.db
			.update(editions)
			.set({ identifiers: [] })
			.where(eq(editions.id, id));
		const linked = await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", { isbns: ["9780306406157"] }),
			book("hc-2", { reading: { state: "finished" } }),
		]);
		expect(linked).toEqual([]);
		expect(await links()).toEqual([]);
		expect(await unmatchedIds()).toEqual(["hc-1", "other-kind"]);
	});

	it("moves an auto link when the match moves to another edition", async () => {
		const first = await edition("First", [
			{ scheme: "ISBN", value: "9780306406157" },
		]);
		await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", { isbns: ["9780306406157"] }),
		]);
		await t.db
			.update(editions)
			.set({ identifiers: [] })
			.where(eq(editions.id, first));
		const second = await edition("Second", [
			{ scheme: "ISBN", value: "0306406152" },
		]);
		await matchProviderBooks(t.db, "hardcover", [
			book("hc-1", { isbns: ["9780306406157"] }),
		]);
		expect(await links()).toEqual([
			{
				editionId: second,
				kind: "hardcover",
				externalId: "hc-1",
				matchedBy: "auto",
			},
		]);
	});
});

describe("lookup-mode links", () => {
	it("links by key, and leaves manual links alone", async () => {
		const a = await edition("A");
		const b = await edition("B");
		expect(await linkByKey(t.db, a, "bookorbit", "digest-a")).toBe(true);
		expect(await linkByKey(t.db, a, "bookorbit", "digest-a")).toBe(true);

		await manualLink(t.db, "bookorbit", "digest-x", b);
		expect(await linkByKey(t.db, b, "bookorbit", "digest-b")).toBe(false);
		expect(await linkByKey(t.db, a, "bookorbit", "digest-x")).toBe(false);
		expect(await links()).toEqual([
			{
				editionId: a,
				kind: "bookorbit",
				externalId: "digest-a",
				matchedBy: "auto",
			},
			{
				editionId: b,
				kind: "bookorbit",
				externalId: "digest-x",
				matchedBy: "manual",
			},
		]);
	});
});

describe("manual links", () => {
	it("replaces an auto link and clears the book from the unmatched list", async () => {
		const id = await edition("One", [
			{ scheme: "ISBN", value: "9780306406157" },
		]);
		await matchProviderBooks(t.db, "hardcover", [
			book("hc-auto", { isbns: ["9780306406157"] }),
			book("hc-lost"),
		]);
		expect(await unmatchedIds()).toEqual(["hc-lost"]);

		await manualLink(t.db, "hardcover", "hc-lost", id);

		expect(await links()).toEqual([
			{
				editionId: id,
				kind: "hardcover",
				externalId: "hc-lost",
				matchedBy: "manual",
			},
		]);
		expect(await unmatchedIds()).toEqual([]);
	});

	it("moves a book linked to another edition, and unlinks", async () => {
		const a = await edition("A");
		const b = await edition("B");
		await manualLink(t.db, "hardcover", "hc-1", a);
		await manualLink(t.db, "hardcover", "hc-1", b);
		expect(await links()).toEqual([
			{
				editionId: b,
				kind: "hardcover",
				externalId: "hc-1",
				matchedBy: "manual",
			},
		]);
		expect(await unlink(t.db, b, "hardcover")).toBe(true);
		expect(await unlink(t.db, b, "hardcover")).toBe(false);
		expect(await links()).toEqual([]);
	});
});

describe("deleting an edition", () => {
	it("removes its links, and the book is unmatched if still being read", async () => {
		const id = await edition("Linked", [
			{ scheme: "ISBN", value: "9780306406157" },
		]);
		const hc = book("hc-1", { isbns: ["9780306406157"] });
		await matchProviderBooks(t.db, "hardcover", [hc]);
		await linkByKey(t.db, id, "bookorbit", "digest");
		expect(await links()).toHaveLength(2);

		const dataDir = await mkdtemp(path.join(os.tmpdir(), "progress-match-"));
		try {
			const log = { info() {}, warn() {} };
			expect(await deleteEdition(t.db, dataDir, id, log)).toEqual({
				deleted: true,
			});
		} finally {
			await rm(dataDir, { recursive: true, force: true });
		}
		expect(await links()).toEqual([]);

		expect(await matchProviderBooks(t.db, "hardcover", [hc])).toEqual([]);
		expect(await unmatchedIds()).toEqual(["hc-1"]);
	});
});

describe("unlinking (design D5a)", () => {
	it("keeps an unlinked auto match unlinked in list mode, listing it while read", async () => {
		const id = await edition("One", [
			{ scheme: "ISBN", value: "9780306406157" },
		]);
		const hc = book("hc-1", { isbns: ["9780306406157"] });
		await matchProviderBooks(t.db, "hardcover", [hc]);
		expect(await unlink(t.db, id, "hardcover")).toBe(true);
		expect(await links()).toEqual([
			{
				editionId: id,
				kind: "hardcover",
				externalId: "hc-1",
				matchedBy: "rejected",
			},
		]);

		expect(await matchProviderBooks(t.db, "hardcover", [hc])).toEqual([]);
		expect((await links()).map((l) => l.matchedBy)).toEqual(["rejected"]);
		expect(await unmatchedIds()).toEqual(["hc-1"]);

		// Another book matching the edition is not auto-linked to it either.
		const other = book("hc-2", { isbns: ["0306406152"] });
		expect(
			await matchProviderBooks(t.db, "hardcover", [
				{ ...hc, reading: { state: "finished" } },
				other,
			]),
		).toEqual([]);
		expect(await unmatchedIds()).toEqual(["hc-2"]);
		// Unlinking again finds no live link.
		expect(await unlink(t.db, id, "hardcover")).toBe(false);
	});

	it("keeps an unlinked auto match unlinked in lookup mode", async () => {
		const a = await edition("A");
		const b = await edition("B");
		expect(await linkByKey(t.db, a, "bookorbit", "digest-a")).toBe(true);
		expect(await unlink(t.db, a, "bookorbit")).toBe(true);
		expect(await linkByKey(t.db, a, "bookorbit", "digest-a")).toBe(false);
		// The rejected key is not moved to another edition, nor the edition to another key.
		expect(await linkByKey(t.db, b, "bookorbit", "digest-a")).toBe(false);
		expect(await linkByKey(t.db, a, "bookorbit", "digest-z")).toBe(false);
		expect(await links()).toEqual([
			{
				editionId: a,
				kind: "bookorbit",
				externalId: "digest-a",
				matchedBy: "rejected",
			},
		]);
	});

	it("links by hand after a rejection, replacing the rejected row", async () => {
		const id = await edition("One", [
			{ scheme: "ISBN", value: "9780306406157" },
		]);
		const other = await edition("Other");
		const hc = book("hc-1", { isbns: ["9780306406157"] });
		await matchProviderBooks(t.db, "hardcover", [hc]);
		await unlink(t.db, id, "hardcover");
		await matchProviderBooks(t.db, "hardcover", [hc]);
		expect(await unmatchedIds()).toEqual(["hc-1"]);

		await manualLink(t.db, "hardcover", "hc-1", id);
		expect(await links()).toEqual([
			{
				editionId: id,
				kind: "hardcover",
				externalId: "hc-1",
				matchedBy: "manual",
			},
		]);
		expect(await unmatchedIds()).toEqual([]);
		expect(await matchProviderBooks(t.db, "hardcover", [hc])).toEqual([
			{ editionId: id, book: hc, matchedBy: "manual" },
		]);

		// Rejected again, then linked by hand to a different edition.
		await unlink(t.db, id, "hardcover");
		expect(await links()).toEqual([]);
		await linkByKey(t.db, id, "bookorbit", "digest");
		await unlink(t.db, id, "bookorbit");
		await manualLink(t.db, "bookorbit", "digest", other);
		expect(await links()).toEqual([
			{
				editionId: other,
				kind: "bookorbit",
				externalId: "digest",
				matchedBy: "manual",
			},
		]);
	});
});
