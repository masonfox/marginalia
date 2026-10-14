import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreprocessCardView, type PreprocessView } from "./preprocess-card";

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
	it("complete shows estimated spend and regenerate", () => {
		const h = render({
			status: "complete",
			totalUnits: 3,
			doneUnits: 3,
			hasSpend: true,
			spendUsd: 0.1234,
		});
		expect(h).toContain("$0.1234");
		expect(h).toContain("(estimate)");
		expect(h).toContain("Regenerate");
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
	it("AI unconfigured hides the action", () => {
		const h = render({ aiEnabled: false });
		expect(h).toContain("AI is not configured");
		expect(h).not.toContain("<button");
	});
});
