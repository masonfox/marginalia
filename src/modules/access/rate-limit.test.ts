import { describe, expect, it } from "vitest";
import { safeNext } from "./guard";
import { clientAddress, LoginRateLimiter } from "./rate-limit";

describe("LoginRateLimiter", () => {
	const clock = () => {
		let now = 1_000_000;
		return { now: () => now, advance: (ms: number) => (now += ms) };
	};

	it("blocks a client after 10 failures within the window", () => {
		const c = clock();
		const limiter = new LoginRateLimiter({ now: c.now });
		for (let i = 0; i < 10; i++) {
			expect(limiter.isBlocked("a")).toBe(false);
			limiter.recordFailure("a");
		}
		expect(limiter.isBlocked("a")).toBe(true);
	});

	it("does not affect other clients", () => {
		const limiter = new LoginRateLimiter();
		for (let i = 0; i < 10; i++) limiter.recordFailure("a");
		expect(limiter.isBlocked("a")).toBe(true);
		expect(limiter.isBlocked("b")).toBe(false);
	});

	it("resets when the 15-minute window elapses", () => {
		const c = clock();
		const limiter = new LoginRateLimiter({ now: c.now });
		for (let i = 0; i < 10; i++) limiter.recordFailure("a");
		c.advance(15 * 60 * 1000 - 1);
		expect(limiter.isBlocked("a")).toBe(true);
		c.advance(1);
		expect(limiter.isBlocked("a")).toBe(false);
		limiter.recordFailure("a");
		expect(limiter.isBlocked("a")).toBe(false);
	});
});

describe("clientAddress", () => {
	const req = new Request("http://x/login", {
		headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.2" },
	});

	it("uses the socket address unless a proxy is trusted", () => {
		expect(clientAddress(req, "10.0.0.2", false)).toBe("10.0.0.2");
		expect(clientAddress(req, "10.0.0.2", true)).toBe("203.0.113.7");
		expect(clientAddress(new Request("http://x/"), undefined, true)).toBe(
			"unknown",
		);
	});
});

describe("safeNext", () => {
	it.each([
		["/p/abc:v1:0.1", "/p/abc:v1:0.1"],
		["/books?x=1", "/books?x=1"],
		["//evil.example", "/"],
		["/\\evil.example", "/"],
		["https://evil.example/", "/"],
		["javascript:alert(1)", "/"],
		[null, "/"],
	])("%s → %s", (input, expected) => {
		expect(safeNext(input)).toBe(expected);
	});
});
