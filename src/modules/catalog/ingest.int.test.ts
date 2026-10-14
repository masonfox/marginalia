import { readdir } from "node:fs/promises";
import path from "node:path";
import { and, count, countDistinct, eq, isNotNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	DRM_MESSAGE,
	type ParsedEdition,
	type ParsedPassage,
	parseEpub,
} from "#/modules/epub";
import { deleteEdition, getEdition } from "#/modules/library";
import { NonRetryableError } from "#/server/jobs/kinds";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures, standardEbooks } from "../../../test/fixtures";
import {
	addUploadedBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import {
	type IngestDeps,
	ingestEdition,
	locatorAliases,
	noteRefs,
	passages,
	reparseEdition,
	resolveSearchConfig,
	sections,
	tocEntries,
} from ".";

let t: TestDb;
let dataDir: string;
let v1: ParsedEdition;
const finalAttempt = { finalAttempt: true };
const firstAttempt = { finalAttempt: false };

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	v1 = await parseEpub(standardEbooks());
});

const deps = (over: Partial<IngestDeps> = {}): IngestDeps => ({
	db: t.db,
	dataDir,
	log: silentLog,
	...over,
});

async function counts(editionId: string) {
	const [p] = await t.db
		.select({ n: count(), distinct: countDistinct(passages.locator) })
		.from(passages)
		.where(eq(passages.editionId, editionId));
	const [s] = await t.db
		.select({ n: count() })
		.from(sections)
		.where(eq(sections.editionId, editionId));
	const [toc] = await t.db
		.select({ n: count() })
		.from(tocEntries)
		.where(eq(tocEntries.editionId, editionId));
	const [notes] = await t.db
		.select({ n: count() })
		.from(noteRefs)
		.innerJoin(passages, eq(noteRefs.fromPassageId, passages.id))
		.where(eq(passages.editionId, editionId));
	return {
		passages: p?.n,
		distinct: p?.distinct,
		sections: s?.n,
		toc: toc?.n,
		notes: notes?.n,
	};
}

const tocSize = (entries: ParsedEdition["toc"]): number =>
	entries.reduce((n, e) => n + 1 + tocSize(e.children), 0);

/** Copies a parse with one passage whose text PostgreSQL rejects, to fail mid-insert. */
function poisoned(parsed: ParsedEdition): ParsedEdition {
	let seen = 0;
	return reshape(parsed, parsed.parserVersion, (ps) =>
		ps.map((p) => (++seen === 150 ? { ...p, text: "bad\u0000byte" } : p)),
	);
}

describe("catalog persistence", () => {
	it("ingests an edition with its full structure", async () => {
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			standardEbooks(),
			"manifesto.epub",
		);
		expect(await ingestEdition(deps(), sha256, finalAttempt)).toBe("ready");
		const row = await getEdition(t.db, edition.id);
		expect(row).toMatchObject({
			status: "ready",
			title: "The Communist Manifesto",
			authors: ["Karl Marx", "Friedrich Engels"],
			parserVersion: 1,
			linearPassageCount: v1.linearPassageCount,
			searchConfig: "english",
			coverPath: expect.stringMatching(/^covers\/[0-9a-f]{64}\.(jpg|png)$/),
		});
		const total = v1.sections.reduce((n, s) => n + s.passages.length, 0);
		expect(await counts(edition.id)).toEqual({
			passages: total,
			distinct: total,
			sections: v1.sections.length,
			toc: tocSize(v1.toc),
			notes: v1.noteRefs.length,
		});
		const [first] = await t.db
			.select({ locator: passages.locator })
			.from(passages)
			.where(
				and(
					eq(passages.editionId, edition.id),
					eq(passages.spineIndex, 0),
					eq(passages.blockIndex, 0),
				),
			);
		expect(first?.locator).toBe(`${sha256.slice(0, 12)}:v1:0.0`);
	});

	it("maps languages to text search configurations, falling back to simple", async () => {
		expect(await resolveSearchConfig(t.db, "en-GB")).toBe("english");
		expect(await resolveSearchConfig(t.db, "fr")).toBe("french");
		expect(await resolveSearchConfig(t.db, "pt_BR")).toBe("portuguese");
		expect(await resolveSearchConfig(t.db, "tlh")).toBe("simple");
		expect(await resolveSearchConfig(t.db, null)).toBe("simple");
	});

	it("leaves exactly one complete passage set when a retry follows a mid-insert failure", async () => {
		// Distinct bytes give a distinct edition; the parse is injected anyway.
		const fresh = await addUploadedBook(
			t.db,
			dataDir,
			Buffer.concat([standardEbooks(), Buffer.from(" ")]),
			"retry.epub",
		);

		await expect(
			ingestEdition(
				deps({ parse: async () => poisoned(v1), batchSize: 50 }),
				fresh.sha256,
				firstAttempt,
			),
		).rejects.toThrow();
		expect((await counts(fresh.edition.id)).passages).toBe(0);
		expect((await getEdition(t.db, fresh.edition.id))?.status).toBe(
			"processing",
		);

		expect(
			await ingestEdition(
				deps({ parse: async () => v1, batchSize: 50 }),
				fresh.sha256,
				finalAttempt,
			),
		).toBe("ready");
		const c = await counts(fresh.edition.id);
		const total = v1.sections.reduce((n, s) => n + s.passages.length, 0);
		expect(c).toMatchObject({
			passages: total,
			distinct: total,
			sections: v1.sections.length,
		});
	});

	it("keeps the previous structure when a reparse fails", async () => {
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			Buffer.concat([standardEbooks(), Buffer.from("  ")]),
			"reparse-fail.epub",
		);
		await ingestEdition(deps({ parse: async () => v1 }), sha256, finalAttempt);
		const before = await counts(edition.id);
		await expect(
			ingestEdition(
				deps({
					parse: async () => poisoned(reshape(v1, 2, (ps) => ps)),
					parserVersion: 2,
					batchSize: 50,
				}),
				sha256,
				finalAttempt,
			),
		).rejects.toThrow();
		expect(await counts(edition.id)).toEqual(before);
		expect(await getEdition(t.db, edition.id)).toMatchObject({
			status: "ready",
			parserVersion: 1,
			error: null,
		});
	});
});

describe("library.ingest handler", () => {
	it("is a no-op when the edition is ready at the current parser version", async () => {
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.epub3(),
			"noop.epub",
		);
		expect(await ingestEdition(deps(), sha256, finalAttempt)).toBe("ready");
		const ids = await t.db
			.select({ id: passages.id })
			.from(passages)
			.where(eq(passages.editionId, edition.id));
		expect(await ingestEdition(deps(), sha256, finalAttempt)).toBe("unchanged");
		const after = await t.db
			.select({ id: passages.id })
			.from(passages)
			.where(eq(passages.editionId, edition.id));
		expect(after).toEqual(ids);
	});

	it("fails a DRM-protected file immediately with the DRM reason", async () => {
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.drm(),
			"drm.epub",
		);
		const err = await ingestEdition(deps(), sha256, firstAttempt).catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(NonRetryableError);
		expect(await getEdition(t.db, edition.id)).toMatchObject({
			status: "failed",
			error: DRM_MESSAGE,
		});
	});

	it("fails a corrupt archive with a reason describing the corruption", async () => {
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.corruptZip(),
			"corrupt.epub",
		);
		const err = await ingestEdition(deps(), sha256, firstAttempt).catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(NonRetryableError);
		const row = await getEdition(t.db, edition.id);
		expect(row?.status).toBe("failed");
		expect(row?.error).toMatch(/ZIP/);
	});

	it("records a transient failure only on the final attempt", async () => {
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.epub2(),
			"flaky.epub",
		);
		const flaky = deps({
			parse: async () => {
				throw new Error("disk hiccup");
			},
		});
		await expect(ingestEdition(flaky, sha256, firstAttempt)).rejects.toThrow(
			"disk hiccup",
		);
		expect((await getEdition(t.db, edition.id))?.status).toBe("processing");
		await expect(ingestEdition(flaky, sha256, finalAttempt)).rejects.toThrow(
			"disk hiccup",
		);
		expect(await getEdition(t.db, edition.id)).toMatchObject({
			status: "failed",
			error: "disk hiccup",
		});
	});
});

describe("locator forwarding on reparse", () => {
	/** v2: front matter gains a passage, one paragraph splits, two merge, one is dropped. */
	const toV2 = (parsed: ParsedEdition) =>
		reshape(parsed, 2, (ps, spine) => {
			const out: ParsedPassage[] = [];
			ps.forEach((p, i) => {
				if (spine === 1 && i === 1) return; // imprint boilerplate removed
				if (spine === 3 && i === 0)
					out.push({ ...p, kind: "paragraph", text: "A new editor's note." });
				if (spine === 3 && i === 1) {
					const cut = p.text.indexOf(". ") + 1;
					out.push(
						{ ...p, text: p.text.slice(0, cut) },
						{ ...p, text: p.text.slice(cut + 1) },
					);
					return;
				}
				if (spine === 5 && i === 2) {
					out.push({ ...p, text: `${p.text} ${ps[3]?.text}` });
					return;
				}
				if (spine === 5 && i === 3) return;
				out.push(p);
			});
			return out;
		});

	async function aliasesOf(editionId: string) {
		return t.db
			.select()
			.from(locatorAliases)
			.where(eq(locatorAliases.editionId, editionId));
	}

	async function currentLocators(editionId: string) {
		const rows = await t.db
			.select({ locator: passages.locator })
			.from(passages)
			.where(eq(passages.editionId, editionId));
		return new Set(rows.map((r) => r.locator));
	}

	it("writes an alias for every v1 locator, pointing at current passages", async () => {
		const bytes = Buffer.concat([standardEbooks(), Buffer.from("v1v2")]);
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			bytes,
			"fwd.epub",
		);
		const short = sha256.slice(0, 12);
		await ingestEdition(deps({ parse: async () => v1 }), sha256, finalAttempt);
		const v1Locators = await currentLocators(edition.id);

		const v2 = toV2(v1);
		await ingestEdition(
			deps({ parse: async () => v2, parserVersion: 2 }),
			sha256,
			finalAttempt,
		);
		expect((await getEdition(t.db, edition.id))?.parserVersion).toBe(2);

		const aliases = await aliasesOf(edition.id);
		const current = await currentLocators(edition.id);
		expect(new Set(aliases.map((a) => a.oldLocator))).toEqual(v1Locators);
		for (const a of aliases) {
			if (a.targetLocator) expect(current.has(a.targetLocator)).toBe(true);
		}
		const by = new Map(aliases.map((a) => [a.oldLocator, a]));
		expect(by.get(`${short}:v1:0.0`)).toMatchObject({
			targetLocator: `${short}:v2:0.0`,
			matchKind: "exact",
		});
		expect(by.get(`${short}:v1:1.1`)).toMatchObject({
			targetLocator: null,
			matchKind: "removed",
		});
		// Renumbered by the inserted note.
		expect(by.get(`${short}:v1:3.0`)).toMatchObject({
			targetLocator: `${short}:v2:3.1`,
			matchKind: "exact",
		});
		// Split: the piece holding the beginning.
		expect(by.get(`${short}:v1:3.1`)).toMatchObject({
			targetLocator: `${short}:v2:3.2`,
			matchKind: "split",
		});
		// Merged: both point at the merged passage.
		expect(by.get(`${short}:v1:5.2`)).toMatchObject({
			targetLocator: `${short}:v2:5.2`,
			matchKind: "merged",
		});
		expect(by.get(`${short}:v1:5.3`)).toMatchObject({
			targetLocator: `${short}:v2:5.2`,
			matchKind: "merged",
		});
		expect(by.get(`${short}:v1:5.4`)).toMatchObject({
			targetLocator: `${short}:v2:5.3`,
			matchKind: "exact",
		});
	});

	it("collapses chains so v1 and v2 locators both point at v3 passages", async () => {
		const bytes = Buffer.concat([standardEbooks(), Buffer.from("v1v2v3")]);
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			bytes,
			"chain.epub",
		);
		const short = sha256.slice(0, 12);
		await ingestEdition(deps({ parse: async () => v1 }), sha256, finalAttempt);
		const v2 = toV2(v1);
		await ingestEdition(
			deps({ parse: async () => v2, parserVersion: 2 }),
			sha256,
			finalAttempt,
		);
		const v2Locators = await currentLocators(edition.id);
		// v3 drops the editor's note again, renumbering section 3.
		const v3 = reshape(v2, 3, (ps, spine) => (spine === 3 ? ps.slice(1) : ps));
		await ingestEdition(
			deps({ parse: async () => v3, parserVersion: 3 }),
			sha256,
			finalAttempt,
		);

		const aliases = await aliasesOf(edition.id);
		const current = await currentLocators(edition.id);
		for (const a of aliases) {
			if (a.targetLocator) {
				expect(a.targetLocator).toMatch(/:v3:/);
				expect(current.has(a.targetLocator)).toBe(true);
			}
		}
		const by = new Map(aliases.map((a) => [a.oldLocator, a]));
		for (const old of v2Locators) expect(by.has(old)).toBe(true);
		expect(by.get(`${short}:v1:3.0`)?.targetLocator).toBe(`${short}:v3:3.0`);
		expect(by.get(`${short}:v2:3.1`)?.targetLocator).toBe(`${short}:v3:3.0`);
		expect(by.get(`${short}:v1:3.1`)).toMatchObject({
			targetLocator: `${short}:v3:3.1`,
			matchKind: "split",
		});
		expect(by.get(`${short}:v1:1.1`)?.targetLocator).toBeNull();
		const [orphans] = await t.db
			.select({ n: count() })
			.from(locatorAliases)
			.where(
				and(
					eq(locatorAliases.editionId, edition.id),
					isNotNull(locatorAliases.targetLocator),
				),
			);
		expect(orphans?.n).toBe(aliases.filter((a) => a.targetLocator).length);
	});
});

describe("deleted editions", () => {
	it("completes without error when the edition no longer exists", async () => {
		const missingSha = "0".repeat(64);
		expect(await ingestEdition(deps(), missingSha, firstAttempt)).toBe(
			"deleted",
		);
		expect(
			await reparseEdition(
				deps(),
				"00000000-0000-0000-0000-000000000000",
				firstAttempt,
			),
		).toBe("deleted");
	});

	it("writes nothing and removes its cover when deleted between parse and persist", async () => {
		// Not epub3: an earlier test leaves it ready, which would make this a no-op.
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.epub2(),
			"deleted-mid-ingest.epub",
		);
		const outcome = await ingestEdition(
			deps({
				parse: async (file, fileName) => {
					const parsed = await parseEpub(file, { fileName });
					await deleteEdition(t.db, dataDir, edition.id, silentLog);
					return parsed;
				},
			}),
			sha256,
			finalAttempt,
		);
		expect(outcome).toBe("deleted");
		expect(await getEdition(t.db, edition.id)).toBeUndefined();
		expect(await counts(edition.id)).toMatchObject({
			passages: 0,
			sections: 0,
			toc: 0,
		});
		const covers = await readdir(path.join(dataDir, "covers")).catch(() => []);
		expect(covers.filter((f) => f.startsWith(sha256))).toEqual([]);
	});
});

describe("bound re-anchoring on reparse", () => {
	const posOf = (parsed: ParsedEdition, spine: number, block: number) => {
		const position = parsed.sections[spine]?.passages[block]?.position;
		if (typeof position !== "number") throw new Error("no linear passage");
		return position;
	};

	/** v2: one passage inserted early, one removed, and two merged later on. */
	const toV2 = (parsed: ParsedEdition) =>
		reshape(parsed, 2, (ps, spine) => {
			const out: ParsedPassage[] = [];
			ps.forEach((p, i) => {
				if (spine === 3 && i === 0)
					out.push({ ...p, kind: "paragraph", text: "A new editor's note." });
				if (spine === 5 && i === 4) return;
				if (spine === 6 && i === 2) {
					out.push({ ...p, text: `${p.text} ${ps[3]?.text}` });
					return;
				}
				if (spine === 6 && i === 3) return;
				out.push(p);
			});
			return out;
		});

	async function reparse(name: string) {
		const { sha256 } = await addUploadedBook(
			t.db,
			dataDir,
			Buffer.concat([standardEbooks(), Buffer.from(name)]),
			`${name}.epub`,
		);
		await ingestEdition(deps({ parse: async () => v1 }), sha256, finalAttempt);
		const v2 = toV2(v1);
		const calls: { editionId: string; rebase: (b: number) => number }[] = [];
		await ingestEdition(
			deps({
				parse: async () => v2,
				parserVersion: 2,
				onReplaced: async (_tx, change) => {
					calls.push(change);
				},
			}),
			sha256,
			finalAttempt,
		);
		expect(calls).toHaveLength(1);
		return { v2, rebase: (calls[0] as (typeof calls)[0]).rebase };
	}

	it("moves a bound with positions shifted by an earlier insertion", async () => {
		const { v2, rebase } = await reparse("rebase-shift");
		const old = posOf(v1, 5, 2);
		expect(rebase(old)).toBe(posOf(v2, 5, 2));
		expect(rebase(old)).toBe(old + 1);
		// Bounds before the insertion do not move.
		expect(rebase(posOf(v1, 2, 0))).toBe(posOf(v1, 2, 0));
	});

	it("falls back to the last surviving passage when the bounded one is removed", async () => {
		const { v2, rebase } = await reparse("rebase-removed");
		expect(rebase(posOf(v1, 5, 4))).toBe(posOf(v2, 5, 3));
	});

	it("never reveals a merged passage holding text after the bound", async () => {
		const { v2, rebase } = await reparse("rebase-merged");
		// Old 6.2 now shares a passage with old 6.3: bounded at 6.2, the merge stays hidden.
		expect(rebase(posOf(v1, 6, 2))).toBe(posOf(v2, 6, 1));
		expect(rebase(posOf(v1, 6, 3))).toBe(posOf(v2, 6, 2));
		expect(rebase(0)).toBe(-1);
	});

	it("does not call the hook when the parser version is unchanged", async () => {
		const { sha256 } = await addUploadedBook(
			t.db,
			dataDir,
			Buffer.concat([standardEbooks(), Buffer.from("rebase-same")]),
			"rebase-same.epub",
		);
		let called = false;
		const onReplaced = async () => {
			called = true;
		};
		await ingestEdition(
			deps({ parse: async () => v1, onReplaced }),
			sha256,
			finalAttempt,
		);
		expect(called).toBe(false);
	});
});
