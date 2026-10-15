import { MockLanguageModelV4 } from "ai/test";
import { and, eq, like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getReadingUnits,
	passages,
	replaceEditionStructure,
} from "#/modules/catalog";
import { parseEpub } from "#/modules/epub";
import { editions, uploadedBookPath } from "#/modules/library";
import { aiUsage } from "#/modules/usage";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import {
	ingestBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import {
	getBookMap,
	getPreprocessStatus,
	lookupObservations,
	markDerivedStale,
	type PreprocessDeps,
	preprocessEdition,
	processUnit,
	StructureChangedError,
	unitSummaries,
} from ".";

let t: TestDb;

const chapters = [
	"Anna walked to the harbour at dawn.",
	"Boris burned the old letters in the stove.",
	"The lighthouse went dark that night.",
];

async function newEdition(title: string) {
	const book = await ingestBook(
		t.db,
		await tempDataDir(),
		await buildEpub({
			title,
			language: "en",
			chapters: chapters.map((body, i) => ({
				href: `c${i}.xhtml`,
				title: `Chapter ${i + 1}`,
				body: `<p>${body}</p>`,
			})),
		}),
		`${title}.epub`,
	);
	return book.id;
}

beforeAll(async () => {
	t = await createTestDb();
});

/** Replies with a valid JSON for whatever unit text is in the prompt. */
function model(
	opts: {
		failOn?: string;
		prompts?: string[];
		/** Receives each call's reasoning and provider options. */
		calls?: { reasoning?: string; providerOptions?: unknown }[];
		/** An extra summary citation added to every reply. */
		cite?: { locator: string; quote: string };
	} = {},
) {
	return new MockLanguageModelV4({
		doGenerate: async (options) => {
			const prompt = JSON.stringify(options.prompt);
			opts.prompts?.push(prompt);
			opts.calls?.push({
				reasoning: options.reasoning,
				providerOptions: options.providerOptions,
			});
			if (opts.failOn && prompt.includes(opts.failOn)) {
				throw new Error("provider down");
			}
			const userText = options.prompt
				.filter((p) => p.role === "user")
				.flatMap((p) => p.content)
				.map((c) => (c.type === "text" ? c.text : ""))
				.join(" ");
			const m = /\[([^\]]+)\] ([^\n]+)/.exec(userText);
			const locator = m?.[1] ?? "x";
			const quote = (m?.[2] ?? "").split(" ").slice(0, 2).join(" ");
			const out = {
				summary: "A thing happens.",
				citations: [{ locator, quote }, ...(opts.cite ? [opts.cite] : [])],
				observations: [
					{
						name: "Anna",
						kind: "character",
						note: "Appears.",
						citations: [{ locator, quote: "never said this" }],
					},
				],
			};
			return {
				content: [{ type: "text", text: JSON.stringify(out) }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: {
					inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 5, text: 5, reasoning: 0 },
				},
				warnings: [],
			} as never;
		},
	});
}

const deps = (m: MockLanguageModelV4 | null): PreprocessDeps => ({
	db: t.db,
	model: m,
	modelName: "mock-pre",
	provider: "openai",
	log: silentLog,
});

describe("preprocessEdition", () => {
	it("stores a summary per unit, flags unverified citations, records usage", async () => {
		const id = await newEdition("Full");
		await preprocessEdition(deps(model()), id);
		const units = await getReadingUnits(t.db, id);
		const map = await getBookMap(t.db, id, null);
		expect(map).toHaveLength(units.length);
		const obs = await lookupObservations(t.db, id, "anna", null, 50);
		expect(obs).toHaveLength(units.length);
		expect(obs[0]?.citations[0]?.verified).toBe(false);
		expect(map[0]?.citations[0]?.verified).toBe(true);
		const usage = await t.db
			.select()
			.from(aiUsage)
			.where(eq(aiUsage.editionId, id));
		expect(usage).toHaveLength(units.length);
		expect(usage[0]?.purpose).toBe("preprocess");
	});

	it("never verifies a valid citation from another unit", async () => {
		const id = await newEdition("Outside");
		const [later] = await t.db
			.select({ locator: passages.locator })
			.from(passages)
			.where(
				and(eq(passages.editionId, id), like(passages.text, "%lighthouse%")),
			);
		if (!later) throw new Error("expected the last chapter's passage");
		const cite = { locator: later.locator, quote: "lighthouse went dark" };
		await preprocessEdition(deps(model({ cite })), id);
		const map = await getBookMap(t.db, id, null);
		// Same-unit control verifies; the later unit's exact quote does not.
		expect(map[0]?.citations[0]?.verified).toBe(true);
		expect(map[0]?.citations[1]).toMatchObject({ ...cite, verified: false });
		// The quote is genuine: it verifies within its own unit.
		expect(map.at(-1)?.citations[1]?.verified).toBe(true);
	});

	it("resumes per unit after a failure and never sends later text", async () => {
		const id = await newEdition("Resume");
		const prompts: string[] = [];
		await expect(
			preprocessEdition(deps(model({ failOn: "burned", prompts })), id),
		).rejects.toThrow(/failed/);
		expect(await getBookMap(t.db, id, null)).toHaveLength(2);
		// Unit 0 never saw later text.
		expect(prompts[0]).not.toContain("burned");
		expect(prompts[0]).not.toContain("lighthouse");
		const second: string[] = [];
		await preprocessEdition(deps(model({ prompts: second })), id);
		expect(second).toHaveLength(1);
		expect(await getBookMap(t.db, id, null)).toHaveLength(3);
	});

	it("regenerates only stale units and is a no-op when current", async () => {
		const id = await newEdition("Stale");
		await preprocessEdition(deps(model()), id);
		const none: string[] = [];
		await preprocessEdition(deps(model({ prompts: none })), id);
		expect(none).toHaveLength(0);
		await t.db.transaction((tx) => markDerivedStale(tx, id));
		expect(await getBookMap(t.db, id, null)).toHaveLength(0);
		await preprocessEdition(deps(model()), id);
		expect(await getBookMap(t.db, id, null)).toHaveLength(3);
		// Dedup: one observation row per name per unit.
		expect(await lookupObservations(t.db, id, "Anna", null, 50)).toHaveLength(
			3,
		);
	});

	it("sends the configured reasoning effort and provider options on every call", async () => {
		const id = await newEdition("Options");
		const calls: { reasoning?: string; providerOptions?: unknown }[] = [];
		const providerOptions = {
			anthropic: { cacheControl: { type: "ephemeral" } },
		};
		await preprocessEdition(
			{ ...deps(model({ calls })), reasoning: "low", providerOptions },
			id,
		);
		expect(calls).toHaveLength(chapters.length);
		for (const c of calls) {
			expect(c).toEqual({ reasoning: "low", providerOptions });
		}
	});

	it("is non-retryable without AI", async () => {
		const id = await newEdition("NoAi");
		await expect(preprocessEdition(deps(null), id)).rejects.toMatchObject({
			name: "NonRetryableError",
		});
	});
});

describe("preprocessEdition across a reparse", () => {
	async function reparsable(title: string) {
		const dir = await tempDataDir();
		const book = await ingestBook(
			t.db,
			dir,
			await buildEpub({
				title,
				language: "en",
				chapters: chapters.map((body, i) => ({
					href: `c${i}.xhtml`,
					title: `Chapter ${i + 1}`,
					body: `<p>${body}</p>`,
				})),
			}),
			`${title}.epub`,
		);
		const parsed = await parseEpub(uploadedBookPath(dir, book.sha256), {
			fileName: `${title}.epub`,
		});
		// A newer parser that finds two more passages in the first chapter.
		const next = reshape(parsed, parsed.parserVersion + 1, (p, spine) =>
			spine === 0
				? [
						...p,
						{ ...p[0], text: "Anna turned back at the pier." },
						{ ...p[0], text: "The gulls followed her home." },
					]
				: p,
		);
		const reparse = () =>
			t.db.transaction((tx) =>
				replaceEditionStructure(tx, book, next, {
					searchConfig: "english",
					coverPath: null,
					onReplaced: (tx, { editionId }) => markDerivedStale(tx, editionId),
				}),
			);
		return { id: book.id, reparse };
	}

	/** Holds the `nth` model call until released, replying with `summary`. */
	function gated(nth: number, summary: string) {
		let release!: () => void;
		let entered!: () => void;
		const held = new Promise<void>((r) => {
			entered = r;
		});
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let calls = 0;
		const m = new MockLanguageModelV4({
			doGenerate: async () => {
				if (++calls === nth) {
					entered();
					await gate;
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								summary,
								citations: [],
								observations: [],
							}),
						},
					],
					finishReason: { unified: "stop", raw: "stop" },
					usage: {
						inputTokens: {
							total: 10,
							noCache: 10,
							cacheRead: 0,
							cacheWrite: 0,
						},
						outputTokens: { total: 5, text: 5, reasoning: 0 },
					},
					warnings: [],
				} as never;
			},
		});
		return { model: m, held, release };
	}

	it("discards a result computed before a reparse committed, and the retry rebuilds", async () => {
		const { id, reparse } = await reparsable("Race");
		const old = gated(2, "Old structure summary.");
		const running = preprocessEdition(deps(old.model), id);
		// Unit 0 is saved; unit 1's model call is in flight on the old passages.
		await old.held;
		expect(await reparse()).toBe(true);
		old.release();
		await expect(running).rejects.toBeInstanceOf(StructureChangedError);

		// Nothing from the old structure is current, so no bound can surface it.
		const rows = await t.db
			.select()
			.from(unitSummaries)
			.where(eq(unitSummaries.editionId, id));
		expect(rows.map((r) => r.unitOrdinal)).toEqual([0]);
		expect(rows.every((r) => r.stale)).toBe(true);
		const units = await getReadingUnits(t.db, id);
		expect(units[0]?.endPosition).toBe(3);
		for (const u of units) {
			expect(await getBookMap(t.db, id, u.endPosition)).toEqual([]);
		}
		expect(await getPreprocessStatus(t.db, id)).toMatchObject({
			status: "stale",
			doneUnits: 0,
			lastError: "The book's structure changed during preprocessing",
		});

		// The retry works from the new structure and carries no old summary over.
		const prompts: string[] = [];
		await preprocessEdition(deps(model({ prompts })), id);
		expect(prompts).toHaveLength(units.length);
		expect(prompts.join()).not.toContain("Old structure summary.");
		expect(prompts[0]).toContain("Anna turned back at the pier.");
		const first = await getBookMap(t.db, id, units[0]?.endPosition ?? 0);
		expect(first).toHaveLength(1);
		expect(first[0]).toMatchObject({ unitOrdinal: 0, endPosition: 3 });
		expect(
			(await getBookMap(t.db, id, null)).map((s) => s.endPosition),
		).toEqual(units.map((u) => u.endPosition));
		expect(await getPreprocessStatus(t.db, id)).toMatchObject({
			status: "complete",
		});
	});

	it("never loads passages for units of a replaced structure", async () => {
		const { id, reparse } = await reparsable("Fence");
		const [unit] = await getReadingUnits(t.db, id);
		if (!unit) throw new Error("expected a unit");
		const [edition] = await t.db
			.select({ generation: editions.structureGeneration })
			.from(editions)
			.where(eq(editions.id, id));
		await reparse();
		const prompts: string[] = [];
		await expect(
			processUnit(
				{
					db: t.db,
					model: model({ prompts }),
					modelName: "mock-pre",
					provider: "openai",
					editionId: id,
					structureGeneration: edition?.generation ?? -1,
				},
				unit,
				null,
			),
		).rejects.toBeInstanceOf(StructureChangedError);
		expect(prompts).toHaveLength(0);
	});
});
