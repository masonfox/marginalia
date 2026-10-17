import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type ObservationKind,
	saveUnitResult,
	type UnitResult,
	unitObservations,
} from "#/modules/analysis";
import { getReadingUnits, passages, type ReadingUnit } from "#/modules/catalog";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import { deleteEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, silentLog, tempDataDir } from "../../../test/library";
import {
	dismissProposal,
	getGuideSubject,
	getSubjectTimeline,
	getUnitAnchors,
	guideDismissedProposals,
	guideSubjectAliases,
	guideSubjects,
	listGuideProposals,
	listGuideSubjects,
	loadSubjectLinks,
	mergeSubjects,
	removeAlias,
	renameSubject,
	resolveSubjects,
	setSubjectKind,
	splitSubject,
} from ".";

let t: TestDb;
let dataDir: string;
let parsed: ParsedEdition;
let units: ReadingUnit[];
let names = 0;

/** A new ready edition of the nested-TOC fixture (three units). */
async function book() {
	const bytes = await fixtures.nestedToc();
	const { id } = await ingestBook(
		t.db,
		dataDir,
		Buffer.concat([bytes, Buffer.from(`${names++}`)]),
		`guide-subjects-${names}.epub`,
		{ parse: async () => parsed },
	);
	return id;
}

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	parsed = await parseEpub(await fixtures.nestedToc());
	units = await getReadingUnits(t.db, await book());
	expect(units).toHaveLength(3);
});

const u = (i: number) => units[i] as ReadingUnit;

type Seen = [name: string, kind?: ObservationKind];

const result = (i: number, seen: Seen[]): UnitResult => ({
	unitOrdinal: i,
	unitLabel: u(i).label,
	endPosition: u(i).endPosition,
	summary: `Summary ${i}`,
	summaryCitations: [],
	observations: seen.map(([name, kind = "character"]) => ({
		name,
		kind,
		note: `${name} in ${i}`,
		citations: [],
	})),
	model: "m",
});

async function preprocessed(seen: Seen[][]) {
	const id = await book();
	for (const [i, names] of seen.entries()) {
		await saveUnitResult(t.db, id, result(i, names));
	}
	return id;
}

const whole = { kind: "whole" } as const;
const through = (i: number) => ({
	kind: "unit" as const,
	endPosition: u(i).endPosition,
});
/** A reveal at the end of unit `i`. */
const revealAt = (i: number) => ({
	kind: "unit" as const,
	endPosition: u(i).endPosition,
});

async function subjectNames(
	id: string,
	bound = whole as typeof whole | ReturnType<typeof through>,
) {
	const listed = await listGuideSubjects(t.db, id, bound);
	if (!listed.ok) throw new Error("expected subjects");
	return listed.subjects.map((s) => [s.ref.slice(0, 2), s.name, s.unitCount]);
}

/** Strider in units 0 and 2, Aragorn in units 1 and 2; Strider revealed as Aragorn at the end of unit 1. */
async function striderBook() {
	const id = await preprocessed([
		[["Strider"]],
		[["Aragorn"]],
		[["Strider"], ["Aragorn"]],
	]);
	const merged = await mergeSubjects(t.db, id, whole, {
		targetRef: "k:aragorn",
		sourceRef: "k:strider",
		reveal: revealAt(1),
	});
	if (!merged.ok) throw new Error(`merge refused: ${merged.reason}`);
	return { id, ref: merged.ref };
}

const observationKinds = async (id: string) =>
	(
		await t.db
			.select({ key: unitObservations.nameKey, kind: unitObservations.kind })
			.from(unitObservations)
			.where(eq(unitObservations.editionId, id))
			.orderBy(unitObservations.endPosition, unitObservations.nameKey)
	).map((r) => `${r.key}:${r.kind}`);

describe("resolveSubjects", () => {
	it("keeps Strider separate before the reveal and groups it with Aragorn after", async () => {
		const { id, ref } = await striderBook();
		expect(ref).toMatch(/^s:\d+$/);
		const anchors = await getUnitAnchors(t.db, id);

		const before = await resolveSubjects(t.db, id, u(0).endPosition, anchors);
		expect(before.refOf("strider")).toBe("k:strider");
		expect(before.keysOf(ref)).toEqual(["aragorn"]);
		expect(await subjectNames(id, through(0))).toEqual([["k:", "Strider", 1]]);
		// Nothing at the bound connects the two: Strider's timeline is Strider's alone.
		const hidden = await getSubjectTimeline(
			t.db,
			id,
			"k:strider",
			u(0).endPosition,
			anchors,
		);
		expect(hidden?.entries.map((e) => e.note)).toEqual(["Strider in 0"]);

		const after = await resolveSubjects(t.db, id, u(1).endPosition, anchors);
		expect(after.refOf("strider")).toBe(ref);
		expect(after.keysOf(ref)).toEqual(["aragorn", "strider"]);
		expect(await subjectNames(id, through(1))).toEqual([["s:", "Strider", 2]]);
		expect(await subjectNames(id)).toEqual([["s:", "Strider", 3]]);
	});

	it("never shows a chosen display name that would spoil", async () => {
		const { id, ref } = await striderBook();
		expect(
			await renameSubject(t.db, id, whole, { ref, displayKey: "aragorn" }),
		).toEqual({ ok: true, ref });
		// Before the reveal only Strider has appeared, as its own subject.
		expect(await subjectNames(id, through(0))).toEqual([["k:", "Strider", 1]]);
		// Revealed with both names visible: the chosen one.
		expect(await subjectNames(id, through(1))).toEqual([["s:", "Aragorn", 2]]);
		const timeline = await getGuideSubject(t.db, id, whole, ref);
		if (!timeline.ok || !timeline.subject) throw new Error("expected timeline");
		expect(timeline.subject.name).toBe("Aragorn");
		expect(timeline.subject.names.map((n) => n.name)).toEqual([
			"Strider",
			"Aragorn",
		]);
	});
});

describe("subject timeline across aliases", () => {
	it("returns the observations of every name in reading order", async () => {
		const id = await preprocessed([
			[["Brawne Lamia"]],
			[["Brawne"], ["Kassad"]],
			[["Brawne Lamia"]],
		]);
		const merged = await mergeSubjects(t.db, id, whole, {
			targetRef: "k:brawne lamia",
			sourceRef: "k:brawne",
			reveal: revealAt(0),
		});
		if (!merged.ok) throw new Error("expected a merge");
		const timeline = await getGuideSubject(t.db, id, whole, merged.ref);
		if (!timeline.ok) throw new Error("expected a timeline");
		expect(
			timeline.subject?.entries.map((e) => [
				e.unitOrdinal,
				e.observedAs,
				e.note,
			]),
		).toEqual([
			[0, null, "Brawne Lamia in 0"],
			[1, "Brawne", "Brawne in 1"],
			[2, null, "Brawne Lamia in 2"],
		]);
		// The merged-in name no longer has a subject of its own.
		const gone = await getGuideSubject(t.db, id, whole, "k:brawne");
		expect(gone.ok && gone.subject).toBeNull();
	});
});

describe("subject edits", () => {
	it("merges with a reveal anchored to the unit's last passage", async () => {
		const { id, ref } = await striderBook();
		const before = await observationKinds(id);
		const { subjects, links } = await loadSubjectLinks(t.db, id);
		expect(subjects).toEqual([
			{ id: Number(ref.slice(2)), displayKey: null, kind: null },
		]);
		const [last] = await t.db
			.select({ locator: passages.locator })
			.from(passages)
			.where(
				and(
					eq(passages.editionId, id),
					eq(passages.position, u(1).endPosition),
				),
			);
		expect(links.sort((a, b) => a.nameKey.localeCompare(b.nameKey))).toEqual([
			{
				nameKey: "aragorn",
				subjectId: Number(ref.slice(2)),
				isPrimary: true,
				revealLocator: null,
				revealPosition: null,
			},
			{
				nameKey: "strider",
				subjectId: Number(ref.slice(2)),
				isPrimary: false,
				revealLocator: last?.locator,
				revealPosition: u(1).endPosition,
			},
		]);
		expect(await observationKinds(id)).toEqual(before);
	});

	it("merges at a passage of the reader's choosing", async () => {
		const id = await preprocessed([[["Lamia"], ["Brawne Lamia"]]]);
		const [passage] = await t.db
			.select({ locator: passages.locator, reveal: passages.revealPosition })
			.from(passages)
			.where(
				and(
					eq(passages.editionId, id),
					eq(passages.position, u(0).startPosition),
				),
			);
		if (!passage) throw new Error("expected a passage");
		const merged = await mergeSubjects(t.db, id, whole, {
			targetRef: "k:brawne lamia",
			sourceRef: "k:lamia",
			reveal: { kind: "passage", locator: passage.locator },
		});
		if (!merged.ok) throw new Error("expected a merge");
		const { links } = await loadSubjectLinks(t.db, id);
		expect(links.find((l) => l.nameKey === "lamia")).toMatchObject({
			revealLocator: passage.locator,
			revealPosition: passage.reveal,
		});
		expect(
			await mergeSubjects(t.db, id, whole, {
				targetRef: merged.ref,
				sourceRef: "k:kassad",
				reveal: { kind: "passage", locator: "nope" },
			}),
		).toEqual({ ok: false, reason: "stale_anchor" });
	});

	it("keeps the later of an alias's own reveal and the merge's", async () => {
		const id = await preprocessed([
			[["Aragorn"], ["Strider"]],
			[["Elessar"], ["Dunadan"]],
			[["Ranger"]],
		]);
		// Strider joins Aragorn late (unit 2); Elessar early (unit 0).
		for (const [target, source, at] of [
			["k:aragorn", "k:strider", 2],
			["k:elessar", "k:dunadan", 0],
		] as const) {
			const r = await mergeSubjects(t.db, id, whole, {
				targetRef: target,
				sourceRef: source,
				reveal: revealAt(at),
			});
			expect(r.ok).toBe(true);
		}
		const { links: first } = await loadSubjectLinks(t.db, id);
		const aragorn = first.find((l) => l.nameKey === "aragorn")?.subjectId;
		const elessar = first.find((l) => l.nameKey === "elessar")?.subjectId;
		// Merge Aragorn's subject into Elessar's at unit 1.
		const merged = await mergeSubjects(t.db, id, whole, {
			targetRef: `s:${elessar}`,
			sourceRef: `s:${aragorn}`,
			reveal: revealAt(1),
		});
		expect(merged).toEqual({ ok: true, ref: `s:${elessar}` });
		const { subjects, links } = await loadSubjectLinks(t.db, id);
		expect(subjects.map((s) => s.id)).toEqual([elessar]);
		const reveal = Object.fromEntries(
			links.map((l) => [l.nameKey, l.revealPosition]),
		);
		expect(reveal).toEqual({
			elessar: null,
			// The target's names keep their reveals.
			dunadan: u(0).endPosition,
			// The source's primary takes the merge's reveal...
			aragorn: u(1).endPosition,
			// ...and an alias revealed later keeps its own.
			strider: u(2).endPosition,
		});
	});

	it("never reveals a hidden alias earlier through its name", async () => {
		const { id, ref } = await striderBook();
		// At unit 0, Strider is shown on its own; the reader links Ranger to it.
		await saveUnitResult(t.db, id, result(0, [["Strider"], ["Ranger"]]));
		const merged = await mergeSubjects(t.db, id, through(0), {
			targetRef: "k:strider",
			sourceRef: "k:ranger",
			reveal: revealAt(0),
		});
		// The reader still sees Strider on its own at their bound.
		expect(merged).toEqual({ ok: true, ref: "k:strider" });
		const { links } = await loadSubjectLinks(t.db, id);
		expect(links.find((l) => l.nameKey === "ranger")).toMatchObject({
			subjectId: Number(ref.slice(2)),
			revealPosition: u(1).endPosition,
		});
		expect(await subjectNames(id, through(0))).toEqual([
			["k:", "Ranger", 1],
			["k:", "Strider", 1],
		]);
		// Merging an already linked, still hidden name changes nothing.
		const again = await mergeSubjects(t.db, id, through(0), {
			targetRef: ref,
			sourceRef: "k:strider",
			reveal: revealAt(0),
		});
		expect(again).toEqual({ ok: true, ref });
		expect((await loadSubjectLinks(t.db, id)).links).toEqual(links);
	});

	it("refuses merging a subject with itself, unknown refs and stale bounds", async () => {
		const { id, ref } = await striderBook();
		const merge = (targetRef: string, sourceRef: string, bound = whole) =>
			mergeSubjects(t.db, id, bound, {
				targetRef,
				sourceRef,
				reveal: revealAt(0),
			});
		expect(await merge(ref, ref)).toEqual({ ok: false, reason: "invalid" });
		expect(await merge("k:x", "k:x")).toEqual({ ok: false, reason: "invalid" });
		expect(await merge(ref, "k:strider")).toEqual({
			ok: false,
			reason: "not_found",
		});
		expect(await merge("s:999999", "k:x")).toEqual({
			ok: false,
			reason: "not_found",
		});
		expect(
			await mergeSubjects(
				t.db,
				id,
				{ kind: "unit", endPosition: u(1).endPosition - 1 },
				{ targetRef: ref, sourceRef: "k:x", reveal: revealAt(0) },
			),
		).toEqual({ ok: false, reason: "stale_bound" });
	});

	it("splits a name out so it is its own subject at every bound", async () => {
		const id = await preprocessed([
			[["Brawne Lamia"]],
			[["Lamia"], ["Brawne"]],
			[["Brawne Lamia"]],
		]);
		let target = "k:brawne lamia";
		for (const source of ["k:lamia", "k:brawne"]) {
			const merged = await mergeSubjects(t.db, id, whole, {
				targetRef: target,
				sourceRef: source,
				reveal: revealAt(1),
			});
			if (!merged.ok) throw new Error("expected a merge");
			// A linked name is reached through its subject.
			target = merged.ref;
		}
		const { links } = await loadSubjectLinks(t.db, id);
		const ref = `s:${links[0]?.subjectId}`;
		const kinds = await observationKinds(id);
		// Only names grouped at the bound can be split out.
		expect(
			await splitSubject(t.db, id, through(0), { ref, nameKey: "lamia" }),
		).toEqual({ ok: false, reason: "invalid" });
		expect(
			await splitSubject(t.db, id, whole, { ref, nameKey: "lamia" }),
		).toEqual({ ok: true, ref });
		for (const bound of [through(1), whole]) {
			expect(await subjectNames(id, bound)).toEqual([
				["s:", "Brawne Lamia", bound.kind === "whole" ? 3 : 2],
				["k:", "Lamia", 1],
			]);
		}
		expect(await observationKinds(id)).toEqual(kinds);
		// Splitting the last alias dissolves the subject.
		expect(
			await splitSubject(t.db, id, whole, { ref, nameKey: "brawne lamia" }),
		).toEqual({ ok: true, ref: "k:brawne" });
		expect(await loadSubjectLinks(t.db, id)).toEqual({
			subjects: [],
			links: [],
		});
	});

	it("removes an alias link, promoting another name when it was the primary", async () => {
		const id = await preprocessed([[["Aragorn"], ["Strider"], ["Elessar"]]]);
		let target = "k:aragorn";
		for (const [source, at] of [
			["k:strider", 0],
			["k:elessar", 2],
		] as const) {
			const merged = await mergeSubjects(t.db, id, whole, {
				targetRef: target,
				sourceRef: source,
				reveal: revealAt(at),
			});
			if (!merged.ok) throw new Error("expected a merge");
			target = merged.ref;
		}
		const { subjects } = await loadSubjectLinks(t.db, id);
		const ref = `s:${subjects[0]?.id}`;
		await renameSubject(t.db, id, whole, { ref, displayKey: "aragorn" });
		expect(await removeAlias(t.db, id, "aragorn")).toBe(true);
		expect(await removeAlias(t.db, id, "aragorn")).toBe(false);
		const after = await loadSubjectLinks(t.db, id);
		expect(after.subjects).toEqual([
			{ id: subjects[0]?.id, displayKey: null, kind: null },
		]);
		expect(
			after.links
				.sort((a, b) => a.nameKey.localeCompare(b.nameKey))
				.map((l) => [l.nameKey, l.isPrimary, l.revealPosition]),
		).toEqual([
			["elessar", false, u(2).endPosition],
			["strider", true, null],
		]);
	});

	it("renames only to one of the subject's names visible at the bound", async () => {
		const { id, ref } = await striderBook();
		expect(
			await renameSubject(t.db, id, through(0), { ref, displayKey: "strider" }),
		).toEqual({ ok: false, reason: "invalid" });
		expect(
			await renameSubject(t.db, id, whole, { ref, displayKey: "gandalf" }),
		).toEqual({ ok: false, reason: "invalid" });
		expect(
			await renameSubject(t.db, id, whole, { ref, displayKey: "strider" }),
		).toEqual({ ok: true, ref });
		expect((await loadSubjectLinks(t.db, id)).subjects[0]?.displayKey).toBe(
			"strider",
		);
	});

	it("sets a kind for display and filtering without touching observations", async () => {
		const id = await preprocessed([
			[["The Green Light", "object"], ["Gatsby"]],
		]);
		const kinds = await observationKinds(id);
		const set = await setSubjectKind(t.db, id, whole, {
			ref: "k:the green light",
			kind: "motif",
		});
		if (!set.ok) throw new Error("expected the kind to be set");
		expect(set.ref).toMatch(/^s:\d+$/);
		const listed = await listGuideSubjects(t.db, id, whole);
		expect(
			listed.ok && listed.subjects.map((s) => [s.name, s.kind, s.readerKind]),
		).toEqual([
			["Gatsby", "character", null],
			["The Green Light", "motif", "motif"],
		]);
		expect(await observationKinds(id)).toEqual(kinds);
		// Clearing it dissolves a subject kept only for its kind.
		expect(
			await setSubjectKind(t.db, id, whole, { ref: set.ref, kind: null }),
		).toEqual({ ok: true, ref: "k:the green light" });
		expect((await loadSubjectLinks(t.db, id)).subjects).toEqual([]);
	});
});

describe("proposals", () => {
	it("proposes visible names only, and never a dismissed pair again", async () => {
		const id = await preprocessed([
			[["Brawne"], ["Will"]],
			[["Brawne Lamia"], ["Will Treaty"]],
			[["Lamia"]],
		]);
		const pairs = async (bound: typeof whole | ReturnType<typeof through>) => {
			const listed = await listGuideProposals(t.db, id, bound);
			if (!listed.ok) throw new Error("expected proposals");
			return listed.proposals.map((p) => [p.primary.name, p.alias.name]);
		};
		expect(await pairs(through(0))).toEqual([]);
		expect(await pairs(through(1))).toEqual([
			["Brawne Lamia", "Brawne"],
			["Will Treaty", "Will"],
		]);
		expect(await dismissProposal(t.db, id, ["will treaty", "will"])).toBe(true);
		expect(await dismissProposal(t.db, id, ["will", "will treaty"])).toBe(true);
		expect(await pairs(whole)).toEqual([
			["Brawne Lamia", "Brawne"],
			["Brawne Lamia", "Lamia"],
		]);
		// A proposal changes nothing until confirmed.
		expect(await subjectNames(id)).toHaveLength(5);
		await mergeSubjects(t.db, id, whole, {
			targetRef: "k:brawne lamia",
			sourceRef: "k:brawne",
			reveal: revealAt(1),
		});
		expect(await pairs(whole)).toEqual([["Brawne Lamia", "Lamia"]]);
		expect(
			await dismissProposal(t.db, "00000000-0000-4000-8000-000000000000", [
				"a",
				"b",
			]),
		).toBe(false);
	});
});

describe("edition deletion", () => {
	it("deletes the edition's subjects, links and dismissals", async () => {
		const { id } = await striderBook();
		await dismissProposal(t.db, id, ["a", "b"]);
		await deleteEdition(t.db, dataDir, id, silentLog);
		for (const table of [
			guideSubjects,
			guideSubjectAliases,
			guideDismissedProposals,
		]) {
			expect(
				await t.db.select().from(table).where(eq(table.editionId, id)),
			).toEqual([]);
		}
	});
});
