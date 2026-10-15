import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createSession,
	LoginRateLimiter,
	SESSION_COOKIE,
	setupPassword,
} from "#/modules/access";
import { getReadingUnits, type ReadingUnit } from "#/modules/catalog";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import { deleteEdition } from "#/modules/library";
import { loadConfig } from "#/server/config";
import { handleRequest } from "#/server/request";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import {
	addUploadedBook,
	ingestBook,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import {
	clearReadingPosition,
	getReadingPosition,
	type PositionChoice,
	readingPositions,
	setReadingPosition,
} from ".";

let t: TestDb;
let dataDir: string;
let units: ReadingUnit[];
let names = 0;

let parsed: ParsedEdition;

/** A new ready edition of the nested-TOC fixture (three units). */
async function book() {
	const bytes = await fixtures.nestedToc();
	// Distinct bytes make a distinct edition; the content is parsed once.
	const { id } = await ingestBook(
		t.db,
		dataDir,
		Buffer.concat([bytes, Buffer.from(`${names++}`)]),
		`position-${names}.epub`,
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

const unit = (i: number): PositionChoice => ({
	kind: "unit",
	endPosition: (units[i] as ReadingUnit).endPosition,
});
const at = (i: number) => ({
	kind: "unit" as const,
	maxPosition: (units[i] as ReadingUnit).endPosition,
	scopeLabel: (units[i] as ReadingUnit).label,
});

describe("reading position", () => {
	it("is unset until the reader sets it", async () => {
		expect(await getReadingPosition(t.db, await book())).toBeNull();
	});

	it("stores a unit's end position and its server-side label", async () => {
		const id = await book();
		expect(await setReadingPosition(t.db, id, unit(1))).toEqual({
			set: true,
			position: at(1),
		});
		expect(await getReadingPosition(t.db, id)).toEqual(at(1));
		expect(at(1).scopeLabel).toBe("Part One › Chapter 2");
	});

	it("moves forward without confirmation", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, unit(0));
		expect(await setReadingPosition(t.db, id, unit(2))).toMatchObject({
			set: true,
		});
		expect(await getReadingPosition(t.db, id)).toEqual(at(2));
		// Setting the same unit again is not a move back.
		expect(await setReadingPosition(t.db, id, unit(2))).toMatchObject({
			set: true,
		});
	});

	it("refuses a move back unless the reader confirms it", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, unit(2));
		expect(await setReadingPosition(t.db, id, unit(0))).toEqual({
			set: false,
			reason: "move_back",
		});
		expect(await getReadingPosition(t.db, id)).toEqual(at(2));
		expect(
			await setReadingPosition(t.db, id, unit(0), { moveBack: true }),
		).toEqual({ set: true, position: at(0) });
		expect(await getReadingPosition(t.db, id)).toEqual(at(0));
	});

	it("rejects a unit that is not one of the current units", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, unit(0));
		const stale = (units[0] as ReadingUnit).endPosition + 1;
		expect(stale).not.toBe((units[1] as ReadingUnit).endPosition);
		for (const moveBack of [false, true]) {
			expect(
				await setReadingPosition(
					t.db,
					id,
					{ kind: "unit", endPosition: stale },
					{ moveBack },
				),
			).toEqual({ set: false, reason: "stale_scope" });
		}
		expect(await getReadingPosition(t.db, id)).toEqual(at(0));
	});

	it("marks a book finished, and a unit after that is a move back", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, unit(1));
		expect(await setReadingPosition(t.db, id, { kind: "whole" })).toEqual({
			set: true,
			position: { kind: "finished" },
		});
		const [row] = await t.db
			.select()
			.from(readingPositions)
			.where(eq(readingPositions.editionId, id));
		expect(row).toMatchObject({ maxPosition: null, scopeLabel: null });
		expect(await setReadingPosition(t.db, id, unit(2))).toEqual({
			set: false,
			reason: "move_back",
		});
		expect(await getReadingPosition(t.db, id)).toEqual({ kind: "finished" });
		expect(
			await setReadingPosition(t.db, id, unit(2), { moveBack: true }),
		).toMatchObject({ set: true, position: at(2) });
	});

	it("clears back to unset", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, unit(1));
		expect(await clearReadingPosition(t.db, id)).toBe(true);
		expect(await getReadingPosition(t.db, id)).toBeNull();
		expect(await clearReadingPosition(t.db, id)).toBe(false);
		// After clearing, any unit is a first set, not a move back.
		expect(await setReadingPosition(t.db, id, unit(0))).toMatchObject({
			set: true,
		});
	});

	it("is not set on a missing or unready book", async () => {
		expect(
			await setReadingPosition(t.db, "00000000-0000-0000-0000-000000000000", {
				kind: "whole",
			}),
		).toEqual({ set: false, reason: "not_found" });
		const { edition } = await addUploadedBook(
			t.db,
			dataDir,
			Buffer.from("not ingested"),
			"pending.epub",
		);
		expect(
			await setReadingPosition(t.db, edition.id, { kind: "whole" }),
		).toEqual({ set: false, reason: "not_found" });
	});

	it("is deleted with its edition", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, unit(1));
		await deleteEdition(t.db, dataDir, id, silentLog);
		expect(
			await t.db
				.select()
				.from(readingPositions)
				.where(eq(readingPositions.editionId, id)),
		).toEqual([]);
	});
});

describe("position server functions behind the access guard", () => {
	const config = loadConfig({ DATABASE_URL: "postgres://unused" });

	/**
	 * Stand-in for the TanStack handler: server functions are routed under
	 * /_serverFn, and reaching it runs the same calls the guide functions make.
	 */
	function app(editionId: string) {
		const calls: string[] = [];
		const handler = async (request: Request) => {
			const url = new URL(request.url);
			calls.push(`${request.method} ${url.pathname}`);
			if (url.pathname.endsWith("/setReadingPositionFn"))
				await setReadingPosition(t.db, editionId, { kind: "whole" });
			if (url.pathname.endsWith("/clearReadingPositionFn"))
				await clearReadingPosition(t.db, editionId);
			const position = await getReadingPosition(t.db, editionId);
			return Response.json(position);
		};
		return { handler, calls };
	}

	const requests = (editionId: string, cookie?: string) => {
		const headers: Record<string, string> = {
			accept: "application/json",
			...(cookie ? { cookie } : {}),
		};
		const payload = encodeURIComponent(JSON.stringify({ data: { editionId } }));
		return [
			new Request(
				`http://books.local/_serverFn/getReadingPositionFn?payload=${payload}`,
				{ headers },
			),
			new Request("http://books.local/_serverFn/setReadingPositionFn", {
				method: "POST",
				headers: { ...headers, "content-type": "application/json" },
				body: JSON.stringify({
					data: { editionId, choice: { kind: "whole" } },
				}),
			}),
			new Request("http://books.local/_serverFn/clearReadingPositionFn", {
				method: "POST",
				headers: { ...headers, "content-type": "application/json" },
				body: JSON.stringify({ data: { editionId } }),
			}),
		];
	};

	it("rejects get, set and clear without a session and changes nothing", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, unit(1));
		const access = {
			db: t.db,
			password: await setupPassword(
				t.db,
				"correct horse battery staple",
				silentLog,
			),
			limiter: new LoginRateLimiter(),
			sessionDays: 30,
			trustProxy: false,
			publicUrl: undefined,
		};
		const { handler, calls } = app(id);
		for (const request of requests(id)) {
			const res = await handleRequest(request, { config, access }, handler);
			expect(res.status).toBe(401);
		}
		expect(calls).toEqual([]);
		expect(await getReadingPosition(t.db, id)).toEqual(at(1));

		// The same calls with a session reach the functions.
		const { token } = await createSession(t.db, 30);
		const cookie = `${SESSION_COOKIE}=${token}`;
		for (const request of requests(id, cookie)) {
			const res = await handleRequest(request, { config, access }, handler);
			expect(res.status).toBe(200);
		}
		expect(calls).toHaveLength(3);
		expect(await getReadingPosition(t.db, id)).toBeNull();
	});
});
