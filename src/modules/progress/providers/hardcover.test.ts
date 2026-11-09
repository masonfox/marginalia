import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderError, RateLimitedError } from "../errors";
import type { ListMatching, ProviderConfig } from "../types";
import {
	createHardcoverProvider,
	HARDCOVER_ENDPOINT,
	type HardcoverDeps,
	normalizeToken,
	parseRetryAfter,
} from "./hardcover";

const FIXTURES = join(import.meta.dirname, "__fixtures__", "hardcover");
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

type Reply =
	| { status?: number; body?: unknown; headers?: Record<string, string> }
	| Error;

/** A fetch stub that answers each call in order and records requests and their times. */
function harness(replies: Reply[], extra: Partial<HardcoverDeps> = {}) {
	let clock = 1_000_000;
	const calls: { at: number; init: RequestInit; url: string }[] = [];
	const sleeps: number[] = [];
	const fetchStub = (async (
		url: string | URL | Request,
		init?: RequestInit,
	) => {
		calls.push({ at: clock, init: init ?? {}, url: String(url) });
		const reply = replies.shift();
		if (!reply) throw new Error("unexpected request");
		if (reply instanceof Error) throw reply;
		return new Response(JSON.stringify(reply.body ?? {}), {
			status: reply.status ?? 200,
			headers: { "content-type": "application/json", ...reply.headers },
		});
	}) as typeof fetch;
	const provider = createHardcoverProvider({
		fetch: fetchStub,
		now: () => clock,
		sleep: async (ms) => {
			sleeps.push(ms);
			clock += ms;
		},
		...extra,
	});
	const list = (cfg: ProviderConfig) =>
		(provider.matching as ListMatching<ProviderConfig>).list(cfg);
	return {
		provider,
		list,
		calls,
		sleeps,
		advance: (ms: number) => {
			clock += ms;
		},
		bodyOf: (i: number) => JSON.parse(String(calls[i]?.init.body)),
	};
}

const cfg = { token: "abc.def.ghi" };

describe("hardcover testConnection", () => {
	it("is ok when `me` returns the user, and sends the bearer token once", async () => {
		const h = harness([{ body: fixture("me-ok") }]);
		const result = await h.provider.testConnection({
			token: "Bearer abc.def.ghi ",
		});
		expect(result).toEqual({
			status: "ok",
			detail: "Signed in as @marginalia_reader",
		});
		expect(h.calls[0]?.url).toBe(HARDCOVER_ENDPOINT);
		const headers = h.calls[0]?.init.headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer abc.def.ghi");
		expect(h.bodyOf(0).query).toContain("me");
	});

	it("is rejected on HTTP 401, which is how Hardcover answers an unknown token", async () => {
		const h = harness([{ status: 401, body: fixture("me-invalid-token") }]);
		expect((await h.provider.testConnection(cfg)).status).toBe("rejected");
	});

	it("is rejected on a JWT GraphQL error", async () => {
		const h = harness([
			{
				body: {
					errors: [
						{
							message: "Could not verify JWT: JWSError JWSInvalidSignature",
							extensions: { path: "$", code: "invalid-jwt" },
						},
					],
				},
			},
		]);
		expect((await h.provider.testConnection(cfg)).status).toBe("rejected");
	});

	it("is rejected with no token, without a request", async () => {
		const h = harness([]);
		expect((await h.provider.testConnection({ token: "  " })).status).toBe(
			"rejected",
		);
		expect(h.calls).toHaveLength(0);
	});

	it("is unreachable when fetch fails", async () => {
		const h = harness([new TypeError("fetch failed")]);
		expect((await h.provider.testConnection(cfg)).status).toBe("unreachable");
	});

	it("is rate-limited on 429", async () => {
		const h = harness([
			{
				status: 429,
				body: fixture("rate-limited"),
				headers: { "retry-after": "30" },
			},
		]);
		expect((await h.provider.testConnection(cfg)).status).toBe("rate-limited");
		expect(h.calls).toHaveLength(1);
	});
});

describe("hardcover list", () => {
	it("maps each status to a reading, skipping ignored books", async () => {
		const h = harness([{ body: fixture("user-books-statuses") }]);
		const books = await h.list(cfg);
		expect(books.map((b) => [b.title, b.reading.state])).toEqual([
			["Fixture Want To Read", "not-started"],
			["Fixture Currently Reading", "reading"],
			["Fixture Read", "finished"],
			["Fixture Did Not Finish", "abandoned"],
			["Fixture Paused", "reading"],
			["Fixture No Identifiers", "abandoned"],
		]);

		const reading = books[1];
		expect(reading).toEqual({
			externalId: "3002",
			ids: { "hardcover-id": "3002" },
			// The read's edition first, then the user book's edition.
			isbns: ["9780999000038", "0999000039", "9780999000021", "0999000020"],
			title: "Fixture Currently Reading",
			// The editor is not an author.
			authors: ["Odile Marsh"],
			reading: {
				state: "reading",
				// Hardcover's progress is a percentage of the read's edition.
				fraction: 0.1701388888888889,
				pages: { current: 49, total: 288 },
				observedAt: new Date("2026-11-06T21:15:00.654Z"),
			},
		});
		// Only reading books carry progress; a finished book is just finished.
		expect(books[2]?.reading).toEqual({
			state: "finished",
			observedAt: new Date("2026-09-12T08:30:00.5Z"),
		});
		expect(books[3]?.reading.fraction).toBeUndefined();
		expect(books[4]?.reading).toMatchObject({
			fraction: 0,
			pages: { current: 0, total: 240 },
		});
		expect(books[0]?.isbns).toEqual(["9780999000014", "0999000012"]);
		expect(books[5]?.isbns).toEqual([]);
		expect(books[5]?.authors).toBeUndefined();
	});

	it("uses pages against the user book's edition when there is no percentage", async () => {
		const h = harness([{ body: fixture("user-books-pages-only") }]);
		const [book] = await h.list(cfg);
		expect(book?.reading).toEqual({
			state: "reading",
			pages: { current: 48, total: 192 },
			observedAt: new Date("2026-11-05T19:00:00.123Z"),
		});
	});

	it("pages through user_books until a short page", async () => {
		const h = harness(
			[
				{ body: fixture("user-books-page-1") },
				{ body: fixture("user-books-page-2") },
			],
			{ pageSize: 2 },
		);
		const books = await h.list(cfg);
		expect(books.map((b) => b.externalId)).toEqual(["5001", "5002", "5003"]);
		expect(h.bodyOf(0).variables).toEqual({ limit: 2, offset: 0 });
		expect(h.bodyOf(1).variables).toEqual({ limit: 2, offset: 2 });
	});

	it("throws a rejected ProviderError on a bad token", async () => {
		const h = harness([{ status: 401, body: fixture("me-invalid-token") }]);
		await expect(h.list(cfg)).rejects.toMatchObject({
			name: "ProviderError",
			reason: "rejected",
		});
	});
});

describe("hardcover throttling", () => {
	it("spaces requests to stay under 60 a minute", async () => {
		const pages = Array.from({ length: 5 }, () => ({
			body: fixture("user-books-page-1"),
		}));
		pages.push({ body: fixture("user-books-page-2") });
		const h = harness(pages, { pageSize: 2 });
		await h.list(cfg);
		expect(h.calls).toHaveLength(6);
		const gaps = h.calls.slice(1).map((c, i) => c.at - (h.calls[i]?.at ?? 0));
		for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(1_200);
		// No more than 50 requests could fit in any minute at this spacing.
		expect(60_000 / Math.min(...gaps)).toBeLessThan(60);
	});

	it("does not wait when requests are already far enough apart", async () => {
		const h = harness([{ body: fixture("me-ok") }, { body: fixture("me-ok") }]);
		await h.provider.testConnection(cfg);
		h.advance(5_000);
		await h.provider.testConnection(cfg);
		expect(h.sleeps).toEqual([]);
	});

	it("waits out Retry-After on 429, then succeeds", async () => {
		const h = harness([
			{
				status: 429,
				body: fixture("rate-limited"),
				headers: { "retry-after": "7" },
			},
			{ body: fixture("user-books-pages-only") },
		]);
		const books = await h.list(cfg);
		expect(books).toHaveLength(1);
		expect(h.calls).toHaveLength(2);
		expect((h.calls[1]?.at ?? 0) - (h.calls[0]?.at ?? 0)).toBe(7_000);
	});

	it("backs off exponentially without Retry-After, then throws RateLimitedError", async () => {
		const limited = { status: 429, body: fixture("rate-limited") };
		const h = harness([limited, limited, limited, limited], { maxRetries: 3 });
		const err = await h.list(cfg).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(RateLimitedError);
		expect(err).toBeInstanceOf(ProviderError);
		expect((err as RateLimitedError).reason).toBe("rate-limited");
		expect(h.calls).toHaveLength(4);
		const gaps = h.calls.slice(1).map((c, i) => c.at - (h.calls[i]?.at ?? 0));
		expect(gaps).toEqual([5_000, 10_000, 20_000]);
	});

	it("carries the last Retry-After on the RateLimitedError", async () => {
		const limited = {
			status: 429,
			body: fixture("rate-limited"),
			headers: { "retry-after": "45" },
		};
		const h = harness([limited, limited], { maxRetries: 1 });
		const err = (await h
			.list(cfg)
			.catch((e: unknown) => e)) as RateLimitedError;
		expect(err.retryAfterMs).toBe(45_000);
	});
});

describe("hardcover helpers", () => {
	it("normalizes tokens with or without the Bearer prefix", () => {
		expect(normalizeToken("Bearer abc")).toBe("abc");
		expect(normalizeToken("  bearer   abc  ")).toBe("abc");
		expect(normalizeToken("abc")).toBe("abc");
		expect(normalizeToken(undefined)).toBe("");
	});

	it("parses Retry-After as seconds or an HTTP date", () => {
		const now = Date.parse("2026-11-07T12:00:00Z");
		expect(parseRetryAfter("12", now)).toBe(12_000);
		expect(parseRetryAfter("Sat, 07 Nov 2026 12:00:30 GMT", now)).toBe(30_000);
		expect(parseRetryAfter(null, now)).toBeUndefined();
		expect(parseRetryAfter("soon", now)).toBeUndefined();
	});
});
