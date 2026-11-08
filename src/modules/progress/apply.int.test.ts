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
	clearPositionByHand,
	getSyncStatus,
	loadMappingInput,
	type MappingInput,
	type ProgressReading,
	type ProviderKind,
	progressLinks,
	progressProviders,
	readingFingerprint,
	unlink,
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

describe("sync details on the link", () => {
	it("records the applied reading on the source link", async () => {
		const id = await book();
		await link(id, "hardcover");
		await applyReading(t.db, id, "hardcover", inside(2));
		const l = await linkRow(id, "hardcover");
		expect(l).toMatchObject({
			appliedReading: inside(2),
			movedBackFrom: null,
		});
		expect(l?.appliedAt).toEqual((await row(id))?.syncedAt);
		expect(await getSyncStatus(t.db, id)).toEqual({
			source: "hardcover",
			reading: inside(2),
			appliedAt: l?.appliedAt,
			movedBackFrom: null,
			excluded: false,
			links: [
				{
					kind: "hardcover",
					matchedBy: "auto",
					enabled: true,
					lastError: null,
					lastAttemptAt: null,
				},
			],
		});
	});

	it("shows a move back to unset, until a manual edit", async () => {
		const id = await book();
		await link(id, "hardcover");
		await applyReading(t.db, id, "hardcover", inside(2));
		// A re-read short of the first unit end clears the position.
		const early = inside(0);
		expect(await applyReading(t.db, id, "hardcover", early)).toEqual({
			status: "applied",
			position: null,
			movedBackFrom: at(1).scopeLabel,
		});
		expect(await row(id)).toBeUndefined();
		const status = await getSyncStatus(t.db, id);
		expect(status).toMatchObject({
			source: "hardcover",
			reading: early,
			movedBackFrom: at(1).scopeLabel,
		});
		expect(status?.appliedAt).toBeInstanceOf(Date);

		// A hand-set position takes precedence.
		await setReadingPosition(t.db, id, {
			kind: "unit",
			endPosition: at(0).maxPosition as number,
		});
		expect(await getSyncStatus(t.db, id)).toMatchObject({
			source: "manual",
			reading: null,
			appliedAt: null,
			movedBackFrom: null,
		});
		// Clearing it by hand leaves nothing synced to show.
		expect(await clearPositionByHand(t.db, id)).toBe(true);
		expect(await getSyncStatus(t.db, id)).toMatchObject({
			source: null,
			reading: null,
			movedBackFrom: null,
		});
		// The fingerprint stays, so the same reading does not undo the clear.
		expect(await applyReading(t.db, id, "hardcover", early)).toEqual({
			status: "unchanged",
		});
	});

	it("records a move back from finished to unset", async () => {
		const id = await book();
		await link(id, "hardcover");
		await applyReading(t.db, id, "hardcover", { state: "finished" });
		await applyReading(t.db, id, "hardcover", { state: "not-started" });
		expect(await linkRow(id, "hardcover")).toMatchObject({
			movedBackFrom: FINISHED_LABEL,
		});
	});

	it("forgets a sync to unset when the reader clears by hand", async () => {
		const id = await book();
		await link(id, "hardcover");
		await applyReading(t.db, id, "hardcover", inside(2));
		await applyReading(t.db, id, "hardcover", inside(0));
		expect(await clearPositionByHand(t.db, id)).toBe(false);
		expect((await getSyncStatus(t.db, id))?.source).toBeNull();
	});

	it("ignores readings for a rejected link, and it is never the source", async () => {
		const id = await book();
		await link(id, "bookorbit");
		await link(id, "hardcover");
		await applyReading(t.db, id, "bookorbit", inside(2));
		await unlink(t.db, id, "bookorbit");
		expect(await applyReading(t.db, id, "bookorbit", inside(1))).toEqual({
			status: "not-linked",
		});
		expect((await linkRow(id, "bookorbit"))?.lastReading).toEqual(inside(2));
		expect(await applyReading(t.db, id, "hardcover", inside(1))).toMatchObject({
			status: "applied",
			position: at(0),
		});
		const status = await getSyncStatus(t.db, id);
		expect(status).toMatchObject({
			source: "hardcover",
			links: [{ kind: "hardcover", matchedBy: "auto", enabled: true }],
		});
	});

	it("reports exclusion, and null for a missing edition", async () => {
		const id = await book();
		await t.db
			.update(editions)
			.set({ progressSyncExcluded: true })
			.where(eq(editions.id, id));
		expect(await getSyncStatus(t.db, id)).toMatchObject({
			source: null,
			excluded: true,
			links: [],
		});
		expect(
			await getSyncStatus(t.db, "00000000-0000-0000-0000-000000000000"),
		).toBeNull();
	});
});
