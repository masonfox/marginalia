// The reader's edits to subjects (design D6): merge, split, display name,
// kind, alias removal and proposal dismissal. Observation rows are never
// touched; only the reader tables change.
import { and, eq } from "drizzle-orm";
import { passages } from "#/modules/catalog";
import { editions } from "#/modules/library";
import type { Database, Executor } from "#/server/db";
import type { PositionChoice } from "./position";
import { getUnitAnchors, loadSubjectLinks } from "./queries";
import type { Anchor } from "./schema";
import {
	guideDismissedProposals,
	guideSubjectAliases,
	guideSubjects,
} from "./schema";
import {
	type AliasLink,
	buildResolution,
	compareKeys,
	dismissalKey,
	implicitRef,
	parseRef,
	type SubjectResolution,
	subjectRef,
} from "./subjects";

/**
 * Where a merge's identity is revealed: the end of a reading unit (its last
 * passage), or any passage of the book by its locator.
 */
export type RevealChoice =
	| { kind: "unit"; endPosition: number }
	| { kind: "passage"; locator: string };

/**
 * A subject edit, or why it was refused. `ref` is the edited subject's ref at
 * the bound afterwards. `not_found`: the edition is missing or not ready, or
 * the subject is not one at the bound. `stale_bound`: the bound is not one of
 * the current units. `stale_anchor`: the reveal unit or passage is not
 * current. `invalid`: the edit does not apply to that subject.
 */
export type SubjectEditResult =
	| { ok: true; ref: string }
	| {
			ok: false;
			reason: "not_found" | "stale_bound" | "stale_anchor" | "invalid";
	  };

type Refusal = Extract<SubjectEditResult, { ok: false }>;
const refuse = (reason: Refusal["reason"]): Refusal => ({ ok: false, reason });

interface EditContext {
	tx: Executor;
	editionId: string;
	bound: number | null;
	links: AliasLink[];
	resolution: SubjectResolution;
}

/**
 * Runs a subject edit in a transaction, with the edition locked against
 * reparses and other edits, and the bound validated against its current
 * units. Names are resolved at the bound, so the reader edits only what the
 * Guide shows them.
 */
async function editAt(
	db: Database,
	editionId: string,
	choice: PositionChoice,
	edit: (ctx: EditContext) => Promise<SubjectEditResult>,
): Promise<SubjectEditResult> {
	return db.transaction(async (tx) => {
		const [edition] = await tx
			.select({ status: editions.status })
			.from(editions)
			.where(eq(editions.id, editionId))
			.for("update");
		if (!edition || edition.status !== "ready") return refuse("not_found");
		let bound: number | null = null;
		if (choice.kind === "unit") {
			const { units } = await getUnitAnchors(tx, editionId);
			const unit = units.find((u) => u.endPosition === choice.endPosition);
			if (!unit) return refuse("stale_bound");
			bound = unit.endPosition;
		}
		const { subjects, links } = await loadSubjectLinks(tx, editionId);
		const resolution = buildResolution({
			subjects,
			links,
			appearances: new Map(),
			bound,
		});
		return edit({ tx, editionId, bound, links, resolution });
	});
}

/** The reveal anchor of a choice among the edition's current passages, or null when it is not one. */
async function revealAnchor(
	tx: Executor,
	editionId: string,
	choice: RevealChoice,
): Promise<Anchor | null> {
	if (choice.kind === "unit") {
		const { units } = await getUnitAnchors(tx, editionId);
		if (!units.some((u) => u.endPosition === choice.endPosition)) return null;
	}
	const [passage] = await tx
		.select({ locator: passages.locator, position: passages.revealPosition })
		.from(passages)
		.where(
			and(
				eq(passages.editionId, editionId),
				choice.kind === "unit"
					? eq(passages.position, choice.endPosition)
					: eq(passages.locator, choice.locator),
			),
		);
	return passage ?? null;
}

/** The later of two anchors: the one that hides an identity longer. */
const later = (a: Anchor, b: Anchor) => (b.position > a.position ? b : a);

/** A link's reveal anchor, or null for a primary name. */
const anchorOf = (link: AliasLink): Anchor | null =>
	link.revealLocator !== null && link.revealPosition !== null
		? { locator: link.revealLocator, position: link.revealPosition }
		: null;

/**
 * What a ref names, structurally: a confirmed subject, or a name key with no
 * link. A name shown as its own subject because its alias is not yet revealed
 * at the bound names its hidden subject, with that link's reveal as a floor:
 * an edit through it must never disclose the hidden identity earlier.
 */
type Target =
	| { kind: "subject"; id: number; floor: Anchor | null }
	| { kind: "name"; key: string };

function targetOf(ctx: EditContext, ref: string): Target | null {
	const parsed = parseRef(ref);
	if (!parsed || ctx.resolution.keysOf(ref) === null) return null;
	if (parsed.kind === "subject")
		return { kind: "subject", id: parsed.id, floor: null };
	const link = ctx.links.find((l) => l.nameKey === parsed.key);
	return link
		? { kind: "subject", id: link.subjectId, floor: anchorOf(link) }
		: { kind: "name", key: parsed.key };
}

/** Creates a subject with `nameKey` as its primary name. */
async function createSubject(
	tx: Executor,
	editionId: string,
	nameKey: string,
	kind: (typeof guideSubjects.$inferInsert)["kind"] = null,
): Promise<number> {
	const [subject] = await tx
		.insert(guideSubjects)
		.values({ editionId, kind })
		.returning({ id: guideSubjects.id });
	if (!subject) throw new Error("subject insert returned no row");
	await tx.insert(guideSubjectAliases).values({
		editionId,
		nameKey,
		subjectId: subject.id,
		isPrimary: true,
	});
	return subject.id;
}

/** The ref a name key has at the bound after an edit. */
async function refAfter(
	tx: Executor,
	editionId: string,
	bound: number | null,
	nameKey: string,
): Promise<string> {
	const { subjects, links } = await loadSubjectLinks(tx, editionId);
	return buildResolution({
		subjects,
		links,
		appearances: new Map(),
		bound,
	}).refOf(nameKey);
}

/**
 * Merges the `source` subject into `target` (design D6). Every name of the
 * source becomes an alias of the target, revealed from the later of its own
 * reveal and the merge's: an identity is never disclosed earlier than a link
 * already said. The target's names are unchanged. Observation kinds are
 * never touched.
 */
export async function mergeSubjects(
	db: Database,
	editionId: string,
	choice: PositionChoice,
	edit: { targetRef: string; sourceRef: string; reveal: RevealChoice },
): Promise<SubjectEditResult> {
	return editAt(db, editionId, choice, async (ctx) => {
		const { tx, links } = ctx;
		const target = targetOf(ctx, edit.targetRef);
		const source = targetOf(ctx, edit.sourceRef);
		if (!target || !source) return refuse("not_found");
		// The name the reader merged into, which they keep seeing afterwards.
		const parsed = parseRef(edit.targetRef);
		const shown =
			target.kind === "name"
				? target.key
				: parsed?.kind === "implicit"
					? parsed.key
					: (links.find((l) => l.subjectId === target.id && l.isPrimary)
							?.nameKey as string);
		if (target.kind === "name" && source.kind === "name") {
			if (target.key === source.key) return refuse("invalid");
		} else if (target.kind === "subject" && source.kind === "subject") {
			if (target.id === source.id) {
				// Already linked, though not yet revealed at the bound: the
				// link's own reveal is the later one, so nothing changes.
				if (!target.floor && !source.floor) return refuse("invalid");
				return {
					ok: true,
					ref: await refAfter(tx, editionId, ctx.bound, shown),
				};
			}
		}
		let reveal = await revealAnchor(tx, editionId, edit.reveal);
		if (!reveal) return refuse("stale_anchor");
		for (const side of [target, source]) {
			if (side.kind === "subject" && side.floor)
				reveal = later(reveal, side.floor);
		}

		const targetId =
			target.kind === "subject"
				? target.id
				: await createSubject(tx, editionId, target.key);
		const moved: AliasLink[] =
			source.kind === "subject"
				? links.filter((l) => l.subjectId === source.id)
				: [
						{
							nameKey: source.key,
							subjectId: 0,
							isPrimary: true,
							revealLocator: null,
							revealPosition: null,
						},
					];
		for (const link of moved) {
			const own = anchorOf(link);
			const anchor = own ? later(own, reveal) : reveal;
			await tx
				.insert(guideSubjectAliases)
				.values({
					editionId,
					nameKey: link.nameKey,
					subjectId: targetId,
					isPrimary: false,
					revealLocator: anchor.locator,
					revealPosition: anchor.position,
				})
				.onConflictDoUpdate({
					target: [guideSubjectAliases.editionId, guideSubjectAliases.nameKey],
					set: {
						subjectId: targetId,
						isPrimary: false,
						revealLocator: anchor.locator,
						revealPosition: anchor.position,
					},
				});
		}
		if (source.kind === "subject") {
			await tx.delete(guideSubjects).where(eq(guideSubjects.id, source.id));
		}
		return { ok: true, ref: await refAfter(tx, editionId, ctx.bound, shown) };
	});
}

/**
 * Removes a name's alias link, restoring it as its own subject at every
 * bound. When it was the primary name, the remaining name revealed earliest
 * becomes primary. A subject left with a single name and no kind of its own
 * is dissolved: that name is its own subject again. Returns whether a link
 * was removed.
 */
export async function removeAlias(
	tx: Executor,
	editionId: string,
	nameKey: string,
): Promise<boolean> {
	const [removed] = await tx
		.delete(guideSubjectAliases)
		.where(
			and(
				eq(guideSubjectAliases.editionId, editionId),
				eq(guideSubjectAliases.nameKey, nameKey),
			),
		)
		.returning({
			subjectId: guideSubjectAliases.subjectId,
			isPrimary: guideSubjectAliases.isPrimary,
		});
	if (!removed) return false;
	const [subject] = await tx
		.select({ displayKey: guideSubjects.displayKey, kind: guideSubjects.kind })
		.from(guideSubjects)
		.where(eq(guideSubjects.id, removed.subjectId));
	const rest = await tx
		.select({
			nameKey: guideSubjectAliases.nameKey,
			revealPosition: guideSubjectAliases.revealPosition,
		})
		.from(guideSubjectAliases)
		.where(eq(guideSubjectAliases.subjectId, removed.subjectId));
	if (rest.length === 0 || (rest.length === 1 && !subject?.kind)) {
		await tx
			.delete(guideSubjects)
			.where(eq(guideSubjects.id, removed.subjectId));
		return true;
	}
	if (removed.isPrimary) {
		const [next] = rest.sort(
			(a, b) =>
				(a.revealPosition ?? 0) - (b.revealPosition ?? 0) ||
				compareKeys(a.nameKey, b.nameKey),
		);
		if (next) {
			await tx
				.update(guideSubjectAliases)
				.set({ isPrimary: true, revealLocator: null, revealPosition: null })
				.where(
					and(
						eq(guideSubjectAliases.editionId, editionId),
						eq(guideSubjectAliases.nameKey, next.nameKey),
					),
				);
		}
	}
	if (subject?.displayKey === nameKey) {
		await tx
			.update(guideSubjects)
			.set({ displayKey: null })
			.where(eq(guideSubjects.id, removed.subjectId));
	}
	return true;
}

/**
 * Splits a name out of a subject so it is its own subject again. Only a
 * name grouped into the subject at the bound can be split out. `ref` is the
 * remaining subject's ref.
 */
export async function splitSubject(
	db: Database,
	editionId: string,
	choice: PositionChoice,
	edit: { ref: string; nameKey: string },
): Promise<SubjectEditResult> {
	return editAt(db, editionId, choice, async (ctx) => {
		const parsed = parseRef(edit.ref);
		const keys = ctx.resolution.keysOf(edit.ref);
		if (parsed?.kind !== "subject" || !keys) return refuse("not_found");
		if (!keys.includes(edit.nameKey) || keys.length < 2)
			return refuse("invalid");
		await removeAlias(ctx.tx, editionId, edit.nameKey);
		const rest = keys.find((k) => k !== edit.nameKey) as string;
		return {
			ok: true,
			ref: await refAfter(ctx.tx, editionId, ctx.bound, rest),
		};
	});
}

/** Chooses the subject's display name among its names grouped at the bound. */
export async function renameSubject(
	db: Database,
	editionId: string,
	choice: PositionChoice,
	edit: { ref: string; displayKey: string },
): Promise<SubjectEditResult> {
	return editAt(db, editionId, choice, async (ctx) => {
		const parsed = parseRef(edit.ref);
		const keys = ctx.resolution.keysOf(edit.ref);
		if (!parsed || !keys) return refuse("not_found");
		if (!keys.includes(edit.displayKey)) return refuse("invalid");
		// A name that is its own subject is already shown under that name.
		if (parsed.kind === "implicit") return { ok: true, ref: edit.ref };
		await ctx.tx
			.update(guideSubjects)
			.set({ displayKey: edit.displayKey })
			.where(eq(guideSubjects.id, parsed.id));
		return { ok: true, ref: edit.ref };
	});
}

/**
 * Sets the subject's kind, used for display and filtering, or clears it
 * (null) back to the kind its observations carry. The kinds stored on
 * observations never change.
 */
export async function setSubjectKind(
	db: Database,
	editionId: string,
	choice: PositionChoice,
	edit: {
		ref: string;
		kind: (typeof guideSubjects.$inferInsert)["kind"];
	},
): Promise<SubjectEditResult> {
	return editAt(db, editionId, choice, async (ctx) => {
		const { tx } = ctx;
		const target = targetOf(ctx, edit.ref);
		if (!target) return refuse("not_found");
		if (target.kind === "name") {
			if (!edit.kind) return { ok: true, ref: edit.ref };
			const id = await createSubject(tx, editionId, target.key, edit.kind);
			return { ok: true, ref: subjectRef(id) };
		}
		// A name shown on its own only because its alias is hidden at the bound.
		if (parseRef(edit.ref)?.kind === "implicit") return refuse("invalid");
		const names = ctx.links.filter((l) => l.subjectId === target.id);
		if (!edit.kind && names.length === 1 && names[0]) {
			// Nothing but the kind kept the single name a subject.
			await tx.delete(guideSubjects).where(eq(guideSubjects.id, target.id));
			return { ok: true, ref: implicitRef(names[0].nameKey) };
		}
		await tx
			.update(guideSubjects)
			.set({ kind: edit.kind ?? null })
			.where(eq(guideSubjects.id, target.id));
		return { ok: true, ref: edit.ref };
	});
}

/**
 * Dismisses a proposed merge of two names: that pair is never proposed
 * again. Returns false when the edition does not exist.
 */
export async function dismissProposal(
	db: Executor,
	editionId: string,
	keys: [string, string],
): Promise<boolean> {
	const [edition] = await db
		.select({ id: editions.id })
		.from(editions)
		.where(eq(editions.id, editionId));
	if (!edition || keys[0] === keys[1]) return false;
	const [keyA, keyB] = dismissalKey(...keys);
	await db
		.insert(guideDismissedProposals)
		.values({ editionId, keyA, keyB })
		.onConflictDoNothing();
	return true;
}
