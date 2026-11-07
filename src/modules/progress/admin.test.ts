import { describe, expect, it } from "vitest";
import { restatesStatus, testResultMessage } from "./admin";

describe("Connection test detail", () => {
	it("drops a detail that only says the status again", () => {
		for (const result of [
			{ status: "rejected", detail: "Hardcover rejected the API token" },
			{ status: "rejected", detail: "Unauthorized" },
			{ status: "rejected", detail: "Invalid credentials" },
			{ status: "rejected", detail: "HTTP 401" },
			{ status: "unreachable", detail: "Hardcover could not be reached" },
			{ status: "rate-limited", detail: "Hardcover is rate limiting requests" },
			{ status: "rate-limited", detail: "HTTP 429" },
		] as const)
			expect(restatesStatus(result), result.detail).toBe(true);
	});

	it("keeps a detail that adds information", () => {
		for (const result of [
			{ status: "rejected", detail: "No Hardcover user for this token" },
			{ status: "unreachable", detail: "connect ECONNREFUSED 10.0.0.9:6060" },
			{ status: "unreachable", detail: "Hardcover answered HTTP 502" },
			{ status: "unreachable", detail: "HTTP 404" },
			{ status: "ok", detail: "Signed in as @reader" },
		] as const)
			expect(restatesStatus(result), result.detail).toBe(false);
	});

	it("words the reason once per status", () => {
		expect(testResultMessage("Hardcover", { status: "rejected" })).toBe(
			"Hardcover rejected the credentials.",
		);
	});
});
