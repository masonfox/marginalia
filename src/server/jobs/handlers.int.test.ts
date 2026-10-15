import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getBookMap,
	getPreprocessStatus,
	lookupObservations,
	saveUnitResult,
	updateRun,
} from "#/modules/analysis";
import { getReadingUnits, ingestEdition, passages } from "#/modules/catalog";
import { PARSER_VERSION, parseEpub } from "#/modules/epub";
import { getReadingPosition, setReadingPosition } from "#/modules/guide";
import { getEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import {
	addUploadedBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import { type AppContext, setAppContext } from "../context";
import { jobHandlers } from "./handlers";

let t: TestDb;
let dataDir: string;
const OLD_VERSION = PARSER_VERSION + 1;
const ctx = {
	id: "job",
	retryCount: 0,
	finalAttempt: false,
	signal: new AbortController().signal,
};

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	setAppContext({
		db: t.db,
		config: { dataDir, preprocessAuto: false },
		log: silentLog,
		ai: { status: { enabled: false } },
		enqueue: async () => null,
	} as unknown as AppContext);
});

/** A ready edition parsed under another parser version, with a complete preprocessing run. */
async function preprocessedEdition(name: string) {
	const bytes = await buildEpub({
		title: name,
		language: "en",
		chapters: [{ href: "a.xhtml", title: "One", body: "<p>Anna waits.</p>" }],
	});
	const { sha256, edition } = await addUploadedBook(
		t.db,
		dataDir,
		bytes,
		`${name}.epub`,
	);
	const old = reshape(await parseEpub(bytes), OLD_VERSION, (ps) => ps);
	await ingestEdition(
		{
			db: t.db,
			dataDir,
			log: silentLog,
			parse: async () => old,
			parserVersion: OLD_VERSION,
		},
		sha256,
		{ finalAttempt: true },
	);
	await saveUnitResult(t.db, edition.id, {
		unitOrdinal: 0,
		unitLabel: "One",
		endPosition: 0,
		summary: "Anna waits.",
		summaryCitations: [],
		observations: [
			{ name: "Anna", kind: "character", note: "Waits.", citations: [] },
		],
		model: "m",
	});
	await updateRun(t.db, edition.id, { status: "complete", totalUnits: 1 });
	return { sha256, editionId: edition.id };
}

describe("reparse keeps the reading position", () => {
	it("keeps the position on the same text and label when positions shift", async () => {
		const bytes = await buildEpub({
			title: "reparse-position",
			chapters: [
				{ href: "part1.xhtml", body: "<h1>Part One</h1>" },
				{ href: "ch1.xhtml", body: "<h2>Chapter 1</h2><p>Alpha.</p>" },
				{ href: "ch2.xhtml", body: "<h2>Chapter 2</h2><p>Beta.</p>" },
				{ href: "ch3.xhtml", body: "<h2>Chapter 3</h2><p>Gamma.</p>" },
			],
			toc: [
				{
					label: "Part One",
					href: "part1.xhtml",
					children: [
						{ label: "Chapter 1", href: "ch1.xhtml" },
						{ label: "Chapter 2", href: "ch2.xhtml" },
						{ label: "Chapter 3", href: "ch3.xhtml" },
					],
				},
			],
		});
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			bytes,
			"reparse-position.epub",
		);
		const current = await parseEpub(bytes);
		// The older parser missed Chapter 1's paragraph, so the reparse inserts it and shifts later positions.
		const old = reshape(current, OLD_VERSION, (ps, spine) =>
			spine === 1 ? ps.filter((p) => p.text !== "Alpha.") : ps,
		);
		const deps = { db: t.db, dataDir, log: silentLog };
		await ingestEdition(
			{ ...deps, parse: async () => old, parserVersion: OLD_VERSION },
			sha256,
			{ finalAttempt: true },
		);
		const [, second] = await getReadingUnits(t.db, edition.id);
		if (!second) throw new Error("expected units");
		await setReadingPosition(t.db, edition.id, {
			kind: "unit",
			endPosition: second.endPosition,
		});
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
		const before = await getReadingPosition(t.db, edition.id);
		if (before?.kind !== "unit") throw new Error("expected a unit position");
		const boundText = await textAt(before.maxPosition);

		await jobHandlers()["catalog.reparse"]?.({ editionId: edition.id }, ctx);
		expect((await getEdition(t.db, edition.id))?.parserVersion).toBe(
			PARSER_VERSION,
		);
		const after = await getReadingPosition(t.db, edition.id);
		expect(after).toEqual({
			kind: "unit",
			maxPosition: before.maxPosition + 1,
			scopeLabel: "Part One › Chapter 2",
		});
		expect(await textAt(before.maxPosition + 1)).toBe(boundText);
		// Still the end of the same, now current, unit.
		const [, now] = await getReadingUnits(t.db, edition.id);
		expect(now?.endPosition).toBe(before.maxPosition + 1);
	});
});

describe("reparse invalidates preprocessing", () => {
	it("hides derived rows after a reparse under a new parser version", async () => {
		const { sha256, editionId } = await preprocessedEdition("reparse-stale");
		await jobHandlers()["library.ingest"]?.({ sha256 }, ctx);
		expect((await getEdition(t.db, editionId))?.parserVersion).toBe(
			PARSER_VERSION,
		);
		expect((await getPreprocessStatus(t.db, editionId)).status).toBe("stale");
		expect(await getBookMap(t.db, editionId, null)).toEqual([]);
		expect(await lookupObservations(t.db, editionId, "Anna", null, 10)).toEqual(
			[],
		);
	});

	it("rolls back invalidation with a failed replacement", async () => {
		const { sha256, editionId } = await preprocessedEdition("reparse-fail");
		// Fails the final edition update, after the replace hook has run.
		await t.db.execute(sql`
			create function fail_ready() returns trigger language plpgsql as
			$$ begin raise exception 'replacement failed'; end $$`);
		await t.db.execute(
			sql.raw(`create trigger fail_ready before update on editions for each row
			when (new.id = '${editionId}') execute function fail_ready()`),
		);
		try {
			await expect(
				jobHandlers()["library.ingest"]?.({ sha256 }, ctx),
			).rejects.toThrow(/update "editions"/);
		} finally {
			await t.db.execute(sql`drop trigger fail_ready on editions`);
		}
		expect((await getEdition(t.db, editionId))?.parserVersion).toBe(
			OLD_VERSION,
		);
		expect((await getPreprocessStatus(t.db, editionId)).status).toBe(
			"complete",
		);
		expect(await getBookMap(t.db, editionId, null)).toHaveLength(1);
		expect(
			await lookupObservations(t.db, editionId, "Anna", null, 10),
		).toHaveLength(1);
	});
});
