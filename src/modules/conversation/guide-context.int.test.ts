import { beforeAll, describe, expect, it } from "vitest";
import { saveUnitResult } from "#/modules/analysis";
import { getReadingUnits, type ReadingUnit } from "#/modules/catalog";
import { mergeSubjects, saveCorrection, splitSubject } from "#/modules/guide";
import { deleteEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { ingestBook, silentLog, tempDataDir } from "../../../test/library";
import {
	appendMessage,
	type ConversationBook,
	createConversation,
	type GuideContextEntry,
	getConversationBooks,
	getGuideStep,
	getMessages,
	getTrailObservations,
	loadBookMaps,
	rebaseGuideContexts,
} from ".";
import { buildBookMapMessage } from "./prompt";

let t: TestDb;
let dataDir: string;

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
});

/** A preprocessed book of `count` one-paragraph chapters, with one summary and observation each. */
async function preprocessedBook(
	count: number,
	nameAt: (i: number) => string = () => "Keeper",
) {
	const e = await ingestBook(
		t.db,
		dataDir,
		await buildEpub({
			title: `Book of ${count}`,
			language: "en",
			chapters: Array.from({ length: count }, (_, i) => ({
				href: `c${i + 1}.xhtml`,
				title: `Chapter ${i + 1}`,
				body: `<p>The keeper speaks in chapter ${i + 1}.</p>`,
			})),
		}),
		`book-${count}-${Math.random()}.epub`,
	);
	const units = await getReadingUnits(t.db, e.id);
	expect(units).toHaveLength(count);
	for (const [i, u] of units.entries()) {
		await t.db.transaction((tx) =>
			saveUnitResult(tx, e.id, {
				unitOrdinal: i,
				unitLabel: u.label,
				endPosition: u.endPosition,
				summary: `Generated summary ${i + 1}.`,
				summaryCitations: [],
				observations: [
					{
						name: nameAt(i),
						kind: "character",
						note: `${nameAt(i)} note ${i + 1}.`,
						citations: [],
					},
				],
				model: "mock",
			}),
		);
	}
	const unit = (i: number) => units[i] as ReadingUnit;
	return { id: e.id, shortId: e.shortId, units, unit };
}

const bookIn = (
	e: { id: string; shortId: string },
	bound: ReadingUnit | null,
): ConversationBook => ({
	editionId: e.id,
	shortId: e.shortId,
	title: "Book",
	authors: [],
	ordinal: 0,
	maxPosition: bound?.endPosition ?? null,
	scopeLabel: bound?.label ?? null,
});

describe("merged book maps", () => {
	it("labels corrected summaries, omits suppressed ones, and ignores corrections beyond the scope", async () => {
		const b = await preprocessedBook(12);
		const book = bookIn(b, b.unit(9));
		const message = async () => {
			const { maps, guideContext } = await loadBookMaps(t.db, [book]);
			return { map: buildBookMapMessage([book], maps), guideContext };
		};
		const before = await message();
		expect(before.map).toContain("Generated summary 10.");
		expect(before.map).not.toContain("Generated summary 11.");
		expect(before.guideContext).toEqual([
			{
				editionId: b.id,
				scopeLabel: b.unit(9).label,
				maxPosition: b.unit(9).endPosition,
				mapFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
			},
		]);

		// A correction beyond the scope leaves the map byte-identical.
		expect(
			await saveCorrection(t.db, b.id, {
				unitLocator: b.unit(11).startLocator,
				target: "summary",
				action: "replace",
				text: "A later correction.",
			}),
		).toMatchObject({ ok: true });
		const beyond = await message();
		expect(beyond.map).toBe(before.map);
		expect(beyond.guideContext).toEqual(before.guideContext);

		// Within the scope: replaced text labelled, suppressed unit omitted.
		await saveCorrection(t.db, b.id, {
			unitLocator: b.unit(3).startLocator,
			target: "summary",
			action: "replace",
			text: "The reader's Chapter 4 <b>.",
		});
		await saveCorrection(t.db, b.id, {
			unitLocator: b.unit(5).startLocator,
			target: "summary",
			action: "suppress",
		});
		const after = await message();
		expect(after.map).toContain(
			`- ${b.unit(3).label} [source="reader correction"]: The reader's Chapter 4 &lt;b&gt;.`,
		);
		expect(after.map).not.toContain("Generated summary 4.");
		expect(after.map).not.toContain("Generated summary 6.");
		expect(after.map).not.toContain(`- ${b.unit(5).label}:`);
		expect(after.map).not.toContain("A later correction.");
		expect(after.guideContext?.[0]?.mapFingerprint).not.toBe(
			before.guideContext?.[0]?.mapFingerprint,
		);
		// Stable again across turns.
		expect((await message()).map).toBe(after.map);
	});

	it("records no guide context for a book without a map", async () => {
		const b = await preprocessedBook(2);
		const { guideContext } = await loadBookMaps(t.db, [
			bookIn(b, { ...b.unit(0), endPosition: b.unit(0).endPosition - 1 }),
		]);
		expect(guideContext).toBeNull();
	});
});

describe("guide step", () => {
	it("lists the summaries now within the recorded scope and says when the guide changed", async () => {
		const b = await preprocessedBook(3);
		const { id: conversationId } = await createConversation(t.db, {
			editionIds: [b.id],
			scopes: {
				[b.id]: {
					maxPosition: b.unit(1).endPosition,
					scopeLabel: b.unit(1).label,
				},
			},
		});
		const [book] = await getConversationBooks(t.db, conversationId);
		const { guideContext } = await loadBookMaps(t.db, [
			book as ConversationBook,
		]);
		const recorded = guideContext?.[0];
		if (!recorded) throw new Error("expected guide context");
		const step = () =>
			getGuideStep(t.db, {
				conversationId,
				editionId: b.id,
				maxPosition: recorded.maxPosition,
				mapFingerprint: recorded.mapFingerprint,
			});

		const unchanged = await step();
		if (unchanged.status !== "ok") throw new Error("expected ok");
		expect(unchanged.changed).toBe(false);
		expect(unchanged.summaries.map((s) => [s.unitLabel, s.summary])).toEqual([
			[b.unit(0).label, "Generated summary 1."],
			[b.unit(1).label, "Generated summary 2."],
		]);
		expect(unchanged.summaries[0]).toMatchObject({
			unitLocator: b.unit(0).startLocator,
			generated: "Generated summary 1.",
			correction: null,
		});

		const saved = await saveCorrection(t.db, b.id, {
			unitLocator: b.unit(0).startLocator,
			target: "summary",
			action: "replace",
			text: "Corrected.",
		});
		if (!saved.ok) throw new Error("expected saved");
		const changed = await step();
		if (changed.status !== "ok") throw new Error("expected ok");
		expect(changed.changed).toBe(true);
		expect(changed.summaries[0]).toMatchObject({
			summary: "Corrected.",
			generated: "Generated summary 1.",
			correction: { id: saved.id, action: "replace", text: "Corrected." },
		});

		// Never past the conversation's scope, whatever the request says.
		const widened = await getGuideStep(t.db, {
			conversationId,
			editionId: b.id,
			maxPosition: null,
			mapFingerprint: recorded.mapFingerprint,
		});
		if (widened.status !== "ok") throw new Error("expected ok");
		expect(widened.summaries).toHaveLength(2);

		await deleteEdition(t.db, dataDir, b.id, silentLog);
		expect(await step()).toEqual({ status: "gone" });
	});
});

describe("guide context rebase", () => {
	it("keeps both books' rebased bounds when their reparses overlap on a shared reply", async () => {
		const [a, b, c] = [
			await preprocessedBook(1),
			await preprocessedBook(4),
			await preprocessedBook(5),
		];
		const { id: conversationId } = await createConversation(t.db, {
			editionIds: [a.id, b.id, c.id],
		});
		const entry = (editionId: string): GuideContextEntry => ({
			editionId,
			scopeLabel: "Chapter 1",
			maxPosition: 100,
			mapFingerprint: "f".repeat(64),
		});
		await appendMessage(t.db, {
			conversationId,
			role: "assistant",
			parts: [],
			guideContext: [entry(a.id), entry(b.id), entry(c.id)],
		});

		// A's reparse rebases the reply and holds its transaction open; B's
		// starts meanwhile, and A commits only once B is waiting on the row.
		let rebasedA!: () => void;
		const aRebased = new Promise<void>((resolve) => {
			rebasedA = resolve;
		});
		let releaseA!: () => void;
		const aReleased = new Promise<void>((resolve) => {
			releaseA = resolve;
		});
		const first = t.db.transaction(async (tx) => {
			await rebaseGuideContexts(tx, a.id, () => 50);
			rebasedA();
			await aReleased;
		});
		await Promise.race([aRebased, first]);
		let settled = false;
		const second = t.db.transaction((tx) =>
			rebaseGuideContexts(tx, b.id, () => 40),
		);
		second.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		const waitingOnLock = async () => {
			const { rows } = await t.pool.query<{ n: number }>(
				"select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
			);
			return (rows[0]?.n ?? 0) > 0;
		};
		while (!settled && !(await waitingOnLock())) {}
		releaseA();
		await Promise.all([first, second]);

		const [reply] = await getMessages(t.db, conversationId);
		expect(reply?.guideContext).toEqual([
			{ ...entry(a.id), maxPosition: 50 },
			{ ...entry(b.id), maxPosition: 40 },
			entry(c.id),
		]);
	});
});

describe("trail observations", () => {
	it("matches stored lookup items to their current rows within the scope", async () => {
		const b = await preprocessedBook(3);
		const { id: conversationId } = await createConversation(t.db, {
			editionIds: [b.id],
			scopes: {
				[b.id]: {
					maxPosition: b.unit(1).endPosition,
					scopeLabel: b.unit(1).label,
				},
			},
		});
		await saveCorrection(t.db, b.id, {
			unitLocator: b.unit(1).startLocator,
			target: "observation",
			nameKey: "keeper",
			action: "suppress",
		});
		const items = await getTrailObservations(t.db, {
			conversationId,
			editionId: b.id,
			name: "Keeper",
			items: [
				{ unitLabel: b.unit(0).label, observedAs: "Keeper" },
				{ unitLabel: b.unit(1).label, observedAs: "Keeper" },
				// Beyond the scope: never matched.
				{ unitLabel: b.unit(2).label, observedAs: "Keeper" },
				{ unitLabel: "No such unit", observedAs: "Keeper" },
			],
		});
		expect(items).toEqual([
			{
				unitLabel: b.unit(0).label,
				unitLocator: b.unit(0).startLocator,
				nameKey: "keeper",
				name: "Keeper",
				generated: "Keeper note 1.",
				correction: null,
			},
			expect.objectContaining({
				unitLocator: b.unit(1).startLocator,
				generated: "Keeper note 2.",
				correction: expect.objectContaining({ action: "suppress" }),
			}),
			null,
			null,
		]);
	});

	it("resolves each item by its own observed name after a split", async () => {
		// Strider in units 0 and 2, Aragorn in unit 1; the scope ends at unit 1.
		const b = await preprocessedBook(3, (i) =>
			i === 1 ? "Aragorn" : "Strider",
		);
		const { id: conversationId } = await createConversation(t.db, {
			editionIds: [b.id],
			scopes: {
				[b.id]: {
					maxPosition: b.unit(1).endPosition,
					scopeLabel: b.unit(1).label,
				},
			},
		});
		const merged = await mergeSubjects(
			t.db,
			b.id,
			{ kind: "whole" },
			{
				targetRef: "k:aragorn",
				sourceRef: "k:strider",
				reveal: { kind: "unit", endPosition: b.unit(0).endPosition },
			},
		);
		if (!merged.ok) throw new Error(`merge refused: ${merged.reason}`);
		// A lookup stored for Strider while the names were one subject.
		const lookup = () =>
			getTrailObservations(t.db, {
				conversationId,
				editionId: b.id,
				name: "Strider",
				items: [
					{ unitLabel: b.unit(0).label, observedAs: "Strider" },
					{ unitLabel: b.unit(1).label, observedAs: "Aragorn" },
					// Beyond the scope, and no current row: never matched.
					{ unitLabel: b.unit(2).label, observedAs: "Strider" },
					{ unitLabel: b.unit(0).label, observedAs: "Aragorn" },
				],
			});
		const expected = [
			expect.objectContaining({
				unitLocator: b.unit(0).startLocator,
				nameKey: "strider",
				generated: "Strider note 1.",
			}),
			expect.objectContaining({
				unitLocator: b.unit(1).startLocator,
				nameKey: "aragorn",
				generated: "Aragorn note 2.",
			}),
			null,
			null,
		];
		expect(await lookup()).toEqual(expected);
		const split = await splitSubject(
			t.db,
			b.id,
			{ kind: "whole" },
			{
				ref: merged.ref,
				nameKey: "strider",
			},
		);
		expect(split.ok).toBe(true);
		expect(await lookup()).toEqual(expected);
	});
});
