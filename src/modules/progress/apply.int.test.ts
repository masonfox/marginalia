import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import {
	FINISHED_LABEL,
	getReadingPosition,
	readingPositions,
	setReadingPosition,
} from "#/modules/guide";
import { editions } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, tempDataDir } from "../../../test/library";
import {
	applyReading,
	loadMappingInput,
	type MappingInput,
	type ProgressReading,
	type ProviderKind,
	progressLinks,
	progressProviders,
	readingFingerprint,
} from ".";

let t: TestDb;
let dataDir: string;
let parsed: ParsedEdition;
let input: MappingInput;
let names = 0;

/** A new ready edition of the nested-TOC fixture (three units). */
async function book() {
	const bytes = await fixtures.nestedToc();
	const { id } = await ingestBook(
		t.db,
		dataDir,
		Buffer.concat([bytes, Buffer.from(`${names++}`)]),
		`apply-${names}.epub`,
		{ parse: async () => parsed },
	);
	return id;
}

async function link(editionId: string, kind: ProviderKind) {
	await t.db.insert(progressLinks).values({
		editionId,
		providerKind: kind,
		externalId: `${kind}-${editionId}`,
		matchedBy: "auto",
	});
}

async function setEnabled(kind: ProviderKind, enabled: boolean) {
	await t.db
		.update(progressProviders)
		.set({ enabled })
		.where(eq(progressProviders.kind, kind));
}

/** A reading in the middle of unit `i`, which maps to the end of unit `i - 1`. */
function inside(i: number): ProgressReading {
	const total = input.passages.reduce((s, p) => s + p.chars, 0);
	const through = (k: number) =>
		k < 0
			? 0
			: input.passages
					.filter((p) => p.position <= (input.units[k]?.endPosition ?? -1))
					.reduce((s, p) => s + p.chars, 0);
	return {
		state: "reading",
		fraction: (through(i - 1) + through(i)) / 2 / total,
	};
}

const at = (i: number) => ({
	kind: "unit" as const,
	maxPosition: input.units[i]?.endPosition,
	scopeLabel: input.units[i]?.label,
});

async function row(editionId: string) {
	const [r] = await t.db
		.select()
		.from(readingPositions)
		.where(eq(readingPositions.editionId, editionId));
	return r;
}

async function linkRow(editionId: string, kind: ProviderKind) {
	const [r] = await t.db
		.select()
		.from(progressLinks)
		.where(
			and(
				eq(progressLinks.editionId, editionId),
				eq(progressLinks.providerKind, kind),
			),
		);
	return r;
}

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	parsed = await parseEpub(await fixtures.nestedToc());
	input = await loadMappingInput(t.db, await book());
	expect(input.units).toHaveLength(3);
});

beforeEach(async () => {
	await t.pool.query("delete from progress_providers");
	await t.db.insert(progressProviders).values([
		{ kind: "bookorbit", enabled: true, priority: 1 },
		{ kind: "hardcover", enabled: true, priority: 2 },
	]);
});

describe("applyReading", () => {
	it("applies a new reading, rounded down, with its source", async () => {
		const id = await book();
		await link(id, "hardcover");
		const reading: ProgressReading = {
			...inside(2),
			observedAt: new Date("2026-11-01T10:00:00Z"),
		};
		expect(await applyReading(t.db, id, "hardcover", reading)).toEqual({
			status: "applied",
			position: at(1),
			movedBackFrom: null,
		});
		expect(await getReadingPosition(t.db, id)).toEqual(at(1));
		const r = await row(id);
		expect(r).toMatchObject({
			source: "hardcover",
			sourceReading: { ...inside(2), observedAt: "2026-11-01T10:00:00.000Z" },
			movedBackFrom: null,
		});
		expect(r?.syncedAt).toBeInstanceOf(Date);
		expect(await linkRow(id, "hardcover")).toMatchObject({
			lastReading: { fraction: reading.fraction },
			lastFingerprint: readingFingerprint(reading),
		});
	});

	it("moves back on a re-read without confirmation, recording where from", async () => {
		const id = await book();
		await link(id, "hardcover");
		await applyReading(t.db, id, "hardcover", { state: "finished" });
		expect(await getReadingPosition(t.db, id)).toEqual({ kind: "finished" });
		expect(await applyReading(t.db, id, "hardcover", inside(2))).toEqual({
			status: "applied",
			position: at(1),
			movedBackFrom: FINISHED_LABEL,
		});
		expect(await applyReading(t.db, id, "hardcover", inside(1))).toEqual({
			status: "applied",
			position: at(0),
			movedBackFrom: at(1).scopeLabel,
		});
		expect(await row(id)).toMatchObject({
			maxPosition: at(0).maxPosition,
			movedBackFrom: at(1).scopeLabel,
		});
		// Moving forward again clears the note.
		await applyReading(t.db, id, "hardcover", inside(2));
		expect((await row(id))?.movedBackFrom).toBeNull();
		// A re-read early in the book unsets the position.
		expect(
			await applyReading(t.db, id, "hardcover", {
				state: "reading",
				fraction: 0,
			}),
		).toMatchObject({ status: "applied", position: null });
		expect(await getReadingPosition(t.db, id)).toBeNull();
	});

	it("keeps a manual edit while the reading is unchanged, and replaces it on a new one", async () => {
		const id = await book();
		await link(id, "hardcover");
		await applyReading(t.db, id, "hardcover", inside(1));
		expect(await getReadingPosition(t.db, id)).toEqual(at(0));
		const fingerprint = (await linkRow(id, "hardcover"))?.lastFingerprint;

		await setReadingPosition(t.db, id, {
			kind: "unit",
			endPosition: at(2).maxPosition as number,
		});
		expect((await row(id))?.source).toBe("manual");
		expect((await linkRow(id, "hardcover"))?.lastFingerprint).toBe(fingerprint);

		// Same reading re-sent with a fresh timestamp.
		expect(
			await applyReading(t.db, id, "hardcover", {
				...inside(1),
				observedAt: new Date(),
			}),
		).toEqual({ status: "unchanged" });
		expect(await getReadingPosition(t.db, id)).toEqual(at(2));
		expect((await row(id))?.source).toBe("manual");

		// New progress replaces the manual edit, even though it is earlier.
		expect(await applyReading(t.db, id, "hardcover", inside(2))).toEqual({
			status: "applied",
			position: at(1),
			movedBackFrom: at(2).scopeLabel,
		});
		expect(await row(id)).toMatchObject({ source: "hardcover" });
	});

	it("leaves an excluded book unchanged, and applies again once included", async () => {
		const id = await book();
		await link(id, "hardcover");
		await setReadingPosition(t.db, id, {
			kind: "unit",
			endPosition: at(0).maxPosition as number,
		});
		await t.db
			.update(editions)
			.set({ progressSyncExcluded: true })
			.where(eq(editions.id, id));
		expect(await applyReading(t.db, id, "hardcover", inside(2))).toEqual({
			status: "excluded",
		});
		expect(await getReadingPosition(t.db, id)).toEqual(at(0));
		expect(await row(id)).toMatchObject({ source: "manual" });
		expect(await linkRow(id, "hardcover")).toMatchObject({
			lastReading: inside(2),
			lastFingerprint: null,
		});

		await t.db
			.update(editions)
			.set({ progressSyncExcluded: false })
			.where(eq(editions.id, id));
		expect(await applyReading(t.db, id, "hardcover", inside(2))).toMatchObject({
			status: "applied",
			position: at(1),
		});
	});

	it("ignores a lower-priority provider but keeps its reading", async () => {
		const id = await book();
		await link(id, "bookorbit");
		await link(id, "hardcover");
		await applyReading(t.db, id, "bookorbit", { state: "finished" });
		expect(await applyReading(t.db, id, "hardcover", inside(1))).toEqual({
			status: "not-source",
			source: "bookorbit",
		});
		expect(await getReadingPosition(t.db, id)).toEqual({ kind: "finished" });
		expect(await row(id)).toMatchObject({ source: "bookorbit" });
		expect(await linkRow(id, "hardcover")).toMatchObject({
			lastReading: inside(1),
			lastFingerprint: null,
		});
	});

	it("follows the lower-priority provider once the higher one is disabled", async () => {
		const id = await book();
		await link(id, "bookorbit");
		await link(id, "hardcover");
		await applyReading(t.db, id, "bookorbit", { state: "finished" });
		await setEnabled("bookorbit", false);
		expect(await applyReading(t.db, id, "bookorbit", inside(1))).toEqual({
			status: "not-source",
			source: "hardcover",
		});
		expect(await applyReading(t.db, id, "hardcover", inside(2))).toEqual({
			status: "applied",
			position: at(1),
			movedBackFrom: FINISHED_LABEL,
		});
		expect(await row(id)).toMatchObject({ source: "hardcover" });
	});

	it("reports an unlinked book", async () => {
		const id = await book();
		expect(await applyReading(t.db, id, "hardcover", inside(1))).toEqual({
			status: "not-linked",
		});
		expect(await getReadingPosition(t.db, id)).toBeNull();
	});
});
