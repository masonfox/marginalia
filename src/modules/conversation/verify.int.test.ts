import { beforeAll, describe, expect, it } from "vitest";
import { ingestEdition } from "#/modules/catalog";
import { parseEpub } from "#/modules/epub";
import { createRetrieval } from "#/modules/retrieval";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { fixtures } from "../../../test/fixtures";
import {
	ingestBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import { type ConversationBook, verifyCitations } from ".";

let t: TestDb;
let main: { id: string; shortId: string };
let outsider: { id: string; shortId: string };
let books: ConversationBook[];

const cite = (locator: string, quote: string) =>
	`[[cite locator="${locator}" quote="${quote.replaceAll('"', '\\"')}"]]`;

const verify = (text: string) =>
	verifyCitations({ retrieval: createRetrieval(t.db), books }, text);

beforeAll(async () => {
	t = await createTestDb();
	const dataDir = await tempDataDir();
	main = await ingestBook(
		t.db,
		dataDir,
		await buildEpub({
			title: "Main",
			language: "en",
			chapters: [
				{
					href: "a.xhtml",
					title: "One",
					body: "<p>The green light burned.</p><p>“Old sport,” said Gatsby, smiling.</p>",
				},
			],
		}),
		"main.epub",
	);
	outsider = await ingestBook(
		t.db,
		dataDir,
		await buildEpub({
			title: "Outsider",
			language: "en",
			chapters: [{ href: "o.xhtml", body: "<p>A secret lantern.</p>" }],
		}),
		"outsider.epub",
	);
	books = [
		{
			editionId: main.id,
			shortId: main.shortId,
			title: "Main",
			authors: [],
			ordinal: 0,
			maxPosition: null,
		},
	];
});

describe("verifyCitations", () => {
	it("verifies a valid quote with its range", async () => {
		const locator = `${main.shortId}:v1:0.0`;
		const [r, ...rest] = await verify(
			`Text ${cite(locator, "green light")} more.`,
		);
		expect(rest).toEqual([]);
		expect(r).toMatchObject({
			editionId: main.id,
			locator,
			currentLocator: locator,
			quote: "green light",
			status: "verified",
			range: { start: 4, end: 15 },
		});
	});

	it("matches curly quotes in the passage against straight quotes in the citation", async () => {
		const locator = `${main.shortId}:v1:0.1`;
		const [r] = await verify(cite(locator, '"Old sport," said Gatsby'));
		expect(r?.status).toBe("verified");
	});

	it("flags a fabricated quote", async () => {
		const locator = `${main.shortId}:v1:0.0`;
		const [r] = await verify(cite(locator, "the blue light faded"));
		expect(r).toMatchObject({ status: "quote_mismatch", editionId: main.id });
	});

	it("flags an unknown locator", async () => {
		const [r] = await verify(cite(`${main.shortId}:v1:9.9`, "anything"));
		expect(r).toMatchObject({ status: "not_found" });
	});

	it("rejects a locator from outside the conversation", async () => {
		const [r] = await verify(
			cite(`${outsider.shortId}:v1:0.0`, "secret lantern"),
		);
		expect(r).toMatchObject({
			status: "not_in_conversation",
			editionId: outsider.id,
			currentLocator: null,
		});
	});

	it("deduplicates repeated markers and ignores malformed ones", async () => {
		const locator = `${main.shortId}:v1:0.0`;
		const records = await verify(
			`${cite(locator, "green")} and ${cite(locator, "green")} and [[cite locator="x"]]`,
		);
		expect(records).toHaveLength(1);
		expect(await verify("no markers at all")).toEqual([]);
	});

	describe("after a reparse", () => {
		let versions: { id: string; shortId: string; sha256: string };

		beforeAll(async () => {
			const dataDir = await tempDataDir();
			const bytes = await fixtures.epub3();
			const v1 = await parseEpub(bytes);
			versions = await ingestBook(t.db, dataDir, bytes, "versions.epub", {
				parse: async () => v1,
			});
			const v2 = reshape(v1, 2, (ps, spine) => {
				if (spine === 1)
					return [
						{ ...(ps[0] as (typeof ps)[number]), text: "Inserted." },
						...ps,
					];
				if (spine === 2) return ps.filter((p) => p.text !== "Fourth.");
				return ps;
			});
			await ingestEdition(
				{
					db: t.db,
					dataDir,
					log: silentLog,
					parse: async () => v2,
					parserVersion: 2,
				},
				versions.sha256,
				{ finalAttempt: true },
			);
			books = [
				...books,
				{
					editionId: versions.id,
					shortId: versions.shortId,
					title: "Versions",
					authors: [],
					ordinal: 1,
					maxPosition: null,
				},
			];
		});

		it("follows a superseded locator to its current passage", async () => {
			const [r] = await verify(cite(`${versions.shortId}:v1:1.1`, "third"));
			expect(r).toMatchObject({
				status: "verified",
				locator: `${versions.shortId}:v1:1.1`,
				currentLocator: `${versions.shortId}:v2:1.2`,
			});
		});

		it("reports a removed locator", async () => {
			const [r] = await verify(cite(`${versions.shortId}:v1:2.1`, "Fourth."));
			expect(r).toMatchObject({ status: "removed", currentLocator: null });
		});
	});
});
