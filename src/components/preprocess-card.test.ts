import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	isActive,
	PreprocessCardView,
	type PreprocessView,
} from "./preprocess-card";

const base: PreprocessView = {
	status: "not_started",
	totalUnits: 0,
	doneUnits: 0,
	failedUnits: 0,
	model: null,
	lastError: null,
	aiEnabled: true,
	configuredModel: "m",
	spendUsd: 0,
	hasSpend: false,
	inputTokens: null,
	outputTokens: null,
};
const render = (v: Partial<PreprocessView>) =>
	renderToStaticMarkup(
		createElement(PreprocessCardView, { view: { ...base, ...v } }),
	);

describe("PreprocessCardView", () => {
	it("not started offers start and warns about privacy", () => {
		const h = render({});
		expect(h).toContain("Not started");
		expect(h).toContain("Start preprocessing");
		expect(h).toContain("whole book text");
	});
	it("running shows progress and disables the action", () => {
		const h = render({
			status: "running",
			totalUnits: 10,
			doneUnits: 4,
			model: "m1",
		});
		expect(h).toContain("4 of 10 sections");
		expect(h).toContain("Model: m1");
		expect(h).toMatch(/<button[^>]*disabled/);
	});
	it("complete shows estimated spend and offers no action", () => {
		const h = render({
			status: "complete",
			totalUnits: 3,
			doneUnits: 3,
			hasSpend: true,
			spendUsd: 0.1234,
		});
		expect(h).toContain("$0.1234");
		expect(h).toContain("(estimate)");
		expect(h).not.toContain("Regenerate");
		expect(h).not.toContain("<button");
	});
	it("shows token counts even when the price is unknown", () => {
		const h = render({
			status: "complete",
			totalUnits: 3,
			doneUnits: 3,
			hasSpend: true,
			spendUsd: null,
			inputTokens: 12345,
			outputTokens: null,
		});
		expect(h).toContain("Spend: unknown");
		expect(h).toContain("Tokens: 12,345 in");
		expect(h).toContain("unknown out");
	});
	it("stale offers regenerate", () => {
		const h = render({ status: "stale", totalUnits: 3, doneUnits: 0 });
		expect(h).toContain("Out of date");
		expect(h).toContain("Regenerate");
	});
	it("failed shows errors and retry", () => {
		const h = render({
			status: "partial",
			totalUnits: 3,
			doneUnits: 2,
			failedUnits: 1,
			lastError: "boom",
		});
		expect(h).toContain("1 sections failed");
		expect(h).toContain("boom");
		expect(h).toContain("Retry");
	});
	it("an interrupted run offers an enabled retry", () => {
		const h = render({
			status: "partial",
			totalUnits: 3,
			doneUnits: 1,
			lastError: "Preprocessing stopped before it finished.",
		});
		expect(h).toContain("Retry");
		expect(h).not.toContain(` disabled=""`);
	});
	it("queued shows the state and keeps polling until a terminal state", () => {
		const h = render({ status: "queued", totalUnits: 0 });
		expect(h).toContain("Queued");
		expect(h).toContain(` disabled=""`);
		expect(isActive("queued")).toBe(true);
		expect(isActive("running")).toBe(true);
		for (const s of ["not_started", "complete", "partial", "stale"] as const) {
			expect(isActive(s)).toBe(false);
		}
	});
	it("AI unconfigured shows no status or action", () => {
		expect(render({ aiEnabled: false })).toBe("");
		expect(
			render({
				aiEnabled: false,
				status: "complete",
				totalUnits: 3,
				doneUnits: 3,
				model: "m1",
				hasSpend: true,
			}),
		).toBe("");
	});
});
