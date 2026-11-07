import { afterEach, describe, expect, it, vi } from "vitest";
import {
	E2E_FAKE_KIND,
	getProvider,
	listProviders,
	PROGRESS_PROVIDERS,
	PROVIDER_KINDS,
} from ".";

describe("progress provider registry", () => {
	it("lists every provider kind, each under its own kind", () => {
		expect(listProviders().map((p) => p.kind)).toEqual([...PROVIDER_KINDS]);
		for (const kind of PROVIDER_KINDS) {
			expect(PROGRESS_PROVIDERS[kind]?.kind).toBe(kind);
			expect(getProvider(kind)).toBe(PROGRESS_PROVIDERS[kind]);
		}
	});

	it("declares each provider's config fields, with keys as secrets", () => {
		const fields = (kind: (typeof PROVIDER_KINDS)[number]) =>
			getProvider(kind).configFields.map((f) => [f.key, f.type]);
		expect(fields("bookorbit")).toEqual([
			["url", "url"],
			["username", "text"],
			["key", "secret"],
		]);
		expect(fields("hardcover")).toEqual([["token", "secret"]]);
	});

	it("matches BookOrbit by lookup and Hardcover by list", () => {
		expect(getProvider("bookorbit").matching.mode).toBe("lookup");
		expect(getProvider("hardcover").matching.mode).toBe("list");
	});
});

describe("the e2e fake provider", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("is not registered without its flag", () => {
		expect(process.env.MARGINALIA_E2E_FAKE_PROGRESS).toBeUndefined();
		expect(PROVIDER_KINDS).toEqual(["bookorbit", "hardcover"]);
		expect(listProviders().map((p) => p.kind)).not.toContain(E2E_FAKE_KIND);
		expect(PROGRESS_PROVIDERS[E2E_FAKE_KIND]).toBeUndefined();
		expect(() => getProvider(E2E_FAKE_KIND)).toThrow();
	});

	it("is not registered when the flag is anything but 1", async () => {
		vi.stubEnv("MARGINALIA_E2E_FAKE_PROGRESS", "true");
		vi.resetModules();
		const fresh = await import(".");
		expect(fresh.PROVIDER_KINDS).not.toContain(E2E_FAKE_KIND);
	});

	it("is registered, list-mode, last, with MARGINALIA_E2E_FAKE_PROGRESS=1", async () => {
		vi.stubEnv("MARGINALIA_E2E_FAKE_PROGRESS", "1");
		vi.resetModules();
		const fresh = await import(".");
		expect(fresh.PROVIDER_KINDS).toEqual([
			"bookorbit",
			"hardcover",
			E2E_FAKE_KIND,
		]);
		const fake = fresh.getProvider(E2E_FAKE_KIND);
		expect(fake.matching.mode).toBe("list");
		expect(fake.configFields.map((f) => [f.key, f.type])).toEqual([
			["isbn", "text"],
			["percent", "text"],
		]);
		if (fake.matching.mode !== "list") throw new Error("not list mode");
		const [book] = await fake.matching.list({
			isbn: "9780000000002",
			percent: "62.5",
		});
		expect(book?.isbns).toEqual(["9780000000002"]);
		expect(book?.reading).toMatchObject({ state: "reading", fraction: 0.625 });
	});
});
