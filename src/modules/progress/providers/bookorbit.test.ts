import { afterEach, describe, expect, it, vi } from "vitest";
import type { Edition } from "#/modules/library";
import type { LookupMatching, ProviderConfig } from "../types";
import auth401 from "./__fixtures__/bookorbit/auth-401.json";
import authOk from "./__fixtures__/bookorbit/auth-ok.json";
import progress401 from "./__fixtures__/bookorbit/progress-401.json";
import progressEmpty from "./__fixtures__/bookorbit/progress-empty.json";
import progressFinished from "./__fixtures__/bookorbit/progress-finished.json";
import progressPercentage from "./__fixtures__/bookorbit/progress-percentage.json";
import progressXPointer from "./__fixtures__/bookorbit/progress-xpointer.json";
import { bookorbit, kosyncBase, parseXPointer } from "./bookorbit";

interface Fixture {
	status: number;
	body: unknown;
}

const cfg: ProviderConfig = {
	url: "https://books.example.com/",
	username: "reader",
	key: "5f4dcc3b5aa765d61d8327deb882cf99",
};
const DIGEST = "0b7f2c1e9d4a6b3c8e5f1a2d7c9b0e43";
const matching = bookorbit.matching as LookupMatching<ProviderConfig>;

function stubFetch(fixture: Fixture) {
	const fn = vi.fn(
		async (_url: string, _init?: RequestInit) =>
			new Response(JSON.stringify(fixture.body), {
				status: fixture.status,
				headers: { "content-type": "application/json" },
			}),
	);
	vi.stubGlobal("fetch", fn);
	return fn;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("BookOrbit testConnection", () => {
	it("calls users/auth with kosync headers and reports ok", async () => {
		const fetch = stubFetch(authOk);
		expect(await bookorbit.testConnection(cfg)).toEqual({ status: "ok" });
		const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://books.example.com/api/v1/koreader/users/auth");
		expect(init.headers).toMatchObject({
			accept: "application/vnd.koreader.v1+json",
			"x-auth-user": "reader",
			"x-auth-key": cfg.key,
		});
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it("reports rejected credentials on 401", async () => {
		stubFetch(auth401);
		expect(await bookorbit.testConnection(cfg)).toEqual({
			status: "rejected",
			detail: "Invalid credentials",
		});
	});

	it("reports rejected on 403 (sync disabled)", async () => {
		stubFetch({ status: 403, body: { message: "Sync is disabled" } });
		expect((await bookorbit.testConnection(cfg)).status).toBe("rejected");
	});

	it("reports rate-limited on 429", async () => {
		stubFetch({ status: 429, body: {} });
		expect((await bookorbit.testConnection(cfg)).status).toBe("rate-limited");
	});

	it("reports unreachable when the request fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed", {
					cause: new Error("connect ECONNREFUSED 10.0.0.9:6060"),
				});
			}),
		);
		expect(await bookorbit.testConnection(cfg)).toEqual({
			status: "unreachable",
			detail: "connect ECONNREFUSED 10.0.0.9:6060",
		});
	});

	it("reports unreachable on timeout", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new DOMException("The operation timed out.", "TimeoutError");
			}),
		);
		expect((await bookorbit.testConnection(cfg)).status).toBe("unreachable");
	});
});

describe("BookOrbit lookup", () => {
	it("keys an edition by its KOReader digest", async () => {
		expect(await matching.keyFor({ koreaderDigest: DIGEST } as Edition)).toBe(
			DIGEST,
		);
		expect(await matching.keyFor({ koreaderDigest: null } as Edition)).toBe(
			null,
		);
	});

	it("parses percentage and a DocFragment xpointer", async () => {
		const fetch = stubFetch(progressXPointer);
		expect(await matching.get(cfg, DIGEST)).toEqual({
			state: "reading",
			fraction: 0.4237,
			locator: { kind: "spine", index: 11 },
			observedAt: new Date(1762444800 * 1000),
		});
		expect(fetch.mock.calls[0]?.[0]).toBe(
			`https://books.example.com/api/v1/koreader/syncs/progress/${DIGEST}`,
		);
	});

	it("parses a percentage-only reading", async () => {
		stubFetch(progressPercentage);
		expect(await matching.get(cfg, DIGEST)).toEqual({
			state: "reading",
			fraction: 0.618,
			observedAt: new Date(1762448400 * 1000),
		});
	});

	it("reports a percentage of 1 as finished", async () => {
		stubFetch(progressFinished);
		expect((await matching.get(cfg, DIGEST))?.state).toBe("finished");
	});

	it("gives null for empty progress", async () => {
		stubFetch(progressEmpty);
		expect(await matching.get(cfg, DIGEST)).toBeNull();
	});

	it("gives null on 404", async () => {
		stubFetch({ status: 404, body: { message: "Not Found" } });
		expect(await matching.get(cfg, DIGEST)).toBeNull();
	});

	it("throws on 401", async () => {
		stubFetch(progress401);
		await expect(matching.get(cfg, DIGEST)).rejects.toThrow(/401/);
	});
});

describe("BookOrbit helpers", () => {
	it("builds the kosync base from any form of the instance URL", () => {
		for (const url of [
			"https://books.example.com",
			"https://books.example.com/",
			"https://books.example.com/api/v1",
			"https://books.example.com/api/v1/koreader/",
		])
			expect(kosyncBase(url)).toBe("https://books.example.com/api/v1/koreader");
	});

	it("ignores page numbers and malformed xpointers", () => {
		expect(parseXPointer("/body/DocFragment[1]/body/p[1]/text().0")).toEqual({
			kind: "spine",
			index: 0,
		});
		expect(parseXPointer("42")).toBeNull();
		expect(parseXPointer("/body/DocFragment[0]")).toBeNull();
	});
});
