import { beforeAll, describe, expect, it } from "vitest";
import { parseEpub } from "#/modules/epub";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import {
	addUploadedBook,
	ingestBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import { getReadingUnits, ingestEdition } from ".";

let t: TestDb;
let dataDir: string;

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
});

describe("getReadingUnits", () => {
	it("derives chapter units from a nested TOC", async () => {
		const book = await ingestBook(
			t.db,
			dataDir,
			await fixtures.nestedToc(),
			"nested.epub",
		);
		const units = await getReadingUnits(t.db, book.id);
		expect(units.map((u) => u.label)).toEqual([
			"Part One › Chapter 1",
			"Part One › Chapter 2",
			"Part Two › Chapter 3",
		]);
		expect(units[0]?.startPosition).toBe(1);
		for (const [i, u] of units.entries()) {
			expect(u.startLocator).toMatch(new RegExp(`^${book.shortId}:v1:`));
			if (i > 0)
				expect(u.startPosition).toBe((units[i - 1]?.endPosition ?? 0) + 1);
		}
		// Part Two's title page belongs to Chapter 3.
		expect(units[2]?.startLocator).toBe(`${book.shortId}:v1:3.0`);
	});

	it("follows a reparse that changes the TOC", async () => {
		const bytes = await fixtures.nestedToc();
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			Buffer.concat([bytes, Buffer.from("reparse")]),
			"nested-reparse.epub",
		);
		const v1 = await parseEpub(bytes);
		const deps = { db: t.db, dataDir, log: silentLog };
		await ingestEdition({ ...deps, parse: async () => v1 }, sha256, {
			finalAttempt: true,
		});
		expect(await getReadingUnits(t.db, edition.id)).toHaveLength(3);

		const v2 = reshape(v1, 2, (ps) => ps);
		v2.toc = v2.toc.flatMap((part) => part.children);
		await ingestEdition(
			{ ...deps, parse: async () => v2, parserVersion: 2 },
			sha256,
			{ finalAttempt: true },
		);
		const units = await getReadingUnits(t.db, edition.id);
		expect(units.map((u) => u.label)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Chapter 3",
		]);
		expect(units[0]?.startLocator).toMatch(/:v2:/);
	});
});
