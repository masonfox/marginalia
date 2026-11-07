import { describe, expect, it } from "vitest";
import {
	getProvider,
	listProviders,
	PROGRESS_PROVIDERS,
	PROVIDER_KINDS,
} from ".";

describe("progress provider registry", () => {
	it("lists every provider kind, each under its own kind", () => {
		expect(listProviders().map((p) => p.kind)).toEqual([...PROVIDER_KINDS]);
		for (const kind of PROVIDER_KINDS) {
			expect(PROGRESS_PROVIDERS[kind].kind).toBe(kind);
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
