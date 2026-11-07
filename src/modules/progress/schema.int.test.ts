import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { readingPositions } from "#/modules/guide";
import { editions, ensureEdition } from "#/modules/library";
import { createDb } from "#/server/db";
import { runMigrations } from "#/server/db/migrate";
import {
	createEmptyDatabase,
	createTestDb,
	type TestDb,
} from "../../../test/db";
import { progressLinks, progressProviders, progressUnmatched } from ".";

const silent = { info() {}, error() {} };
const sha = () => randomBytes(32).toString("hex");

let t: TestDb;

beforeAll(async () => {
	t = await createTestDb();
});

describe("progress sync migration", () => {
	it("reads positions saved before the migration back as manual", async () => {
		const url = await createEmptyDatabase();
		const handle = createDb(url);
		const folder = await mkdtemp(path.join(os.tmpdir(), "progress-migration-"));
		try {
			await cp("drizzle", folder, { recursive: true });
			const journalPath = path.join(folder, "meta/_journal.json");
			const journal = JSON.parse(await readFile(journalPath, "utf8"));
			const target = journal.entries.findIndex(
				(entry: { tag: string }) => entry.tag === "0019_progress_sync",
			);
			expect(target).toBeGreaterThan(0);
			journal.entries = journal.entries.slice(0, target);
			await writeFile(journalPath, JSON.stringify(journal));
			await runMigrations(handle.pool, silent, folder);

			const old = sha();
			await handle.pool.query(
				"insert into editions (sha256, short_id, title) values ($1, $2, 'Old book')",
				[old, old.slice(0, 12)],
			);
			await handle.pool.query(
				"insert into reading_positions (edition_id, max_position, scope_label) select id, 7, 'Chapter 2' from editions",
			);

			await runMigrations(handle.pool, silent);

			const [position] = await handle.db.select().from(readingPositions);
			expect(position).toMatchObject({
				maxPosition: 7,
				scopeLabel: "Chapter 2",
				source: "manual",
				sourceReading: null,
				syncedAt: null,
				movedBackFrom: null,
			});
			const [edition] = await handle.db.select().from(editions);
			expect(edition).toMatchObject({
				koreaderDigest: null,
				progressSyncExcluded: false,
			});
		} finally {
			await handle.pool.end();
			await rm(folder, { recursive: true, force: true });
		}
	});

	it("defaults new positions to manual", async () => {
		const { edition } = await ensureEdition(t.db, sha(), "New book");
		await t.db
			.insert(readingPositions)
			.values({ editionId: edition.id, maxPosition: 3, scopeLabel: "One" });
		const [position] = await t.db
			.select()
			.from(readingPositions)
			.where(eq(readingPositions.editionId, edition.id));
		expect(position?.source).toBe("manual");
		expect(position?.movedBackFrom).toBeNull();
	});
});

describe("progress tables", () => {
	it("cascades links and unmatched books from editions and providers", async () => {
		const { edition } = await ensureEdition(t.db, sha(), "Linked book");
		await t.db.insert(progressProviders).values([
			{ kind: "hardcover", priority: 1 },
			{ kind: "bookorbit", priority: 2 },
		]);
		await t.db.insert(progressLinks).values([
			{
				editionId: edition.id,
				providerKind: "hardcover",
				externalId: "hc-1",
				matchedBy: "auto",
			},
			{
				editionId: edition.id,
				providerKind: "bookorbit",
				externalId: "digest",
				matchedBy: "manual",
			},
		]);
		await t.db.insert(progressUnmatched).values({
			providerKind: "hardcover",
			externalId: "hc-2",
			title: "Elsewhere",
			reading: { state: "reading", fraction: 0.4 },
		});

		// One external book links to at most one edition per provider.
		const other = (await ensureEdition(t.db, sha(), "Other")).edition;
		await expect(
			t.db.insert(progressLinks).values({
				editionId: other.id,
				providerKind: "hardcover",
				externalId: "hc-1",
				matchedBy: "auto",
			}),
		).rejects.toThrow();

		await t.db
			.delete(progressProviders)
			.where(eq(progressProviders.kind, "hardcover"));
		expect(
			(await t.db.select().from(progressLinks)).map((l) => l.providerKind),
		).toEqual(["bookorbit"]);
		expect(await t.db.select().from(progressUnmatched)).toEqual([]);

		await t.db.delete(editions).where(eq(editions.id, edition.id));
		expect(await t.db.select().from(progressLinks)).toEqual([]);
	});
});
