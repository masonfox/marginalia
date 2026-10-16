import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiSelection } from "#/server/config";
import {
	isActive,
	PreprocessCardView,
	type PreprocessView,
} from "./preprocess-card";

const haiku: AiSelection = { provider: "anthropic", model: "claude-haiku" };

const base: PreprocessView = {
	status: "not_started",
	totalUnits: 0,
	doneUnits: 0,
	failedUnits: 0,
	provider: null,
	model: null,
	lastError: null,
	aiEnabled: true,
	preprocessDefault: { selection: haiku, available: true },
	spendUsd: 0,
	hasSpend: false,
	inputTokens: null,
	outputTokens: null,
};

const router = createRouter({
	routeTree: createRootRoute(),
	history: createMemoryHistory(),
});

/** The picker and links need a router and a query client; .ts tests pass children as props. */
const wrap = (element: ReactElement) =>
	renderToStaticMarkup(
		createElement(RouterContextProvider, {
			router,
			// biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
			children: createElement(QueryClientProvider, {
				client: new QueryClient(),
				// biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
				children: element,
			}),
		}),
	);

const render = (
	v: Partial<PreprocessView>,
	props: {
		choice?: AiSelection | null;
		providers?: AiSelection["provider"][];
	} = {},
) =>
	wrap(
		createElement(PreprocessCardView, {
			view: { ...base, ...v },
			providers: ["anthropic", "openai"],
			...props,
		}),
	);

describe("PreprocessCardView", () => {
	it("not started offers start and warns about privacy", () => {
		const h = render({});
		expect(h).toContain("Not started");
		expect(h).toContain("Start preprocessing");
		expect(h).toContain("whole book text");
	});
	it("running shows progress and offers only cancel", () => {
		const h = render({
			status: "running",
			totalUnits: 10,
			doneUnits: 4,
			model: "m1",
		});
		expect(h).toContain("4 of 10 sections");
		expect(h).toContain("Model: m1");
		expect(h).toContain("Cancel preprocessing");
		expect(h).not.toContain(` disabled=""`);
		expect(h).not.toContain("Retry");
		expect(h).not.toContain("whole book text");
	});
	it("cancelled keeps progress and offers resume", () => {
		const h = render({ status: "cancelled", totalUnits: 10, doneUnits: 4 });
		expect(h).toContain("Cancelled");
		expect(h).toContain("4 of 10 sections");
		expect(h).toContain("Resume");
		expect(h).not.toContain("Cancel preprocessing");
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
		expect(h).toContain("Cancel preprocessing");
		expect(isActive("queued")).toBe(true);
		expect(isActive("running")).toBe(true);
		for (const s of [
			"not_started",
			"complete",
			"partial",
			"cancelled",
			"stale",
		] as const) {
			expect(isActive(s)).toBe(false);
		}
	});
	it("AI unconfigured on a book never preprocessed shows nothing", () => {
		expect(render({ aiEnabled: false }, { providers: [] })).toBe("");
	});
	it.each([
		"queued",
		"running",
	] as const)("a %s run stays cancellable after the last provider is removed", (status) => {
		const h = render(
			{
				aiEnabled: false,
				status,
				totalUnits: 10,
				doneUnits: 4,
				provider: "anthropic",
				model: "claude-haiku",
				hasSpend: true,
				spendUsd: 0.05,
			},
			{ providers: [] },
		);
		expect(h).toContain("4 of 10 sections");
		expect(h).toContain("Model: Anthropic / claude-haiku");
		expect(h).toContain("$0.0500");
		expect(h).toContain("Cancel preprocessing");
		expect(h).not.toContain(` disabled=""`);
		expect(h).not.toContain("Model for this run");
	});
	it("keeps a finished run's status and spend without a provider", () => {
		const h = render(
			{
				aiEnabled: false,
				status: "complete",
				totalUnits: 3,
				doneUnits: 3,
				model: "m1",
				hasSpend: true,
				spendUsd: 0.1234,
			},
			{ providers: [] },
		);
		expect(h).toContain("Complete");
		expect(h).toContain("Last run: m1");
		expect(h).toContain("$0.1234");
		expect(h).not.toContain("<button");
	});
	it("keeps a failed run's error but offers no new run without a provider", () => {
		const h = render(
			{
				aiEnabled: false,
				status: "partial",
				totalUnits: 3,
				doneUnits: 1,
				lastError: "Anthropic / claude-haiku is unavailable.",
			},
			{ choice: { provider: "openai", model: "gpt-small" }, providers: [] },
		);
		expect(h).toContain("Incomplete");
		expect(h).toContain("Anthropic / claude-haiku is unavailable.");
		expect(h).toContain('href="/settings"');
		expect(h).not.toContain("<button");
		expect(h).not.toContain("Model for this run");
		expect(h).not.toContain(">Provider</label>");
	});
	it.each([
		"cancelled",
		"stale",
	] as const)("a %s run offers no new run while providers are empty", (status) => {
		const h = render(
			{ status, totalUnits: 3, doneUnits: 1 },
			{ providers: [] },
		);
		expect(h).toContain('href="/settings"');
		expect(h).not.toContain("<button");
		expect(h).not.toContain(">Provider</label>");
	});
});

describe("PreprocessCardView model", () => {
	const startButton = (h: string) =>
		h.match(/<button[^>]*>Start preprocessing<\/button>/)?.[0] ?? "";

	it("preselects the default with a change control", () => {
		const h = render({});
		expect(h).toContain("Model for this run");
		expect(h).toContain("Anthropic / claude-haiku");
		expect(h).toContain("(default)");
		expect(h).toContain(">Change</button>");
		expect(startButton(h)).not.toContain(`disabled=""`);
	});
	it("shows the last run's model and the default separately", () => {
		const h = render({
			status: "cancelled",
			totalUnits: 30,
			doneUnits: 10,
			provider: "openai",
			model: "gpt-small",
		});
		expect(h).toContain("Last run: OpenAI / gpt-small");
		expect(h).toContain("Anthropic / claude-haiku");
		expect(h).toContain("(default)");
	});
	it("names a run model recorded without a provider", () => {
		expect(
			render({ status: "running", totalUnits: 3, model: "old-model" }),
		).toContain("Model: old-model");
	});
	it("a chosen model replaces the default for this run, with a way back", () => {
		const h = render(
			{},
			{ choice: { provider: "openai", model: "gpt-small" } },
		);
		expect(h).toContain('value="gpt-small"');
		expect(h).toContain("Use default (Anthropic / claude-haiku)");
		expect(h).not.toContain(">Change</button>");
		expect(startButton(h)).not.toContain(`disabled=""`);
	});
	it("needs a model typed when one was chosen", () => {
		const h = render({}, { choice: { provider: "openai", model: " " } });
		expect(startButton(h)).toContain(`disabled=""`);
	});
	it("without a default, asks for a model and points to Settings", () => {
		const h = render({
			preprocessDefault: { selection: null, available: false },
		});
		expect(h).toContain("No preprocessing default is set.");
		expect(h).toContain('href="/settings"');
		expect(h).toContain(">Provider</label>");
		expect(startButton(h)).toContain(`disabled=""`);
	});
	it("an unavailable default is named and not used", () => {
		const h = render({
			preprocessDefault: { selection: haiku, available: false },
		});
		expect(h).toContain(
			"The default, Anthropic / claude-haiku, is unavailable",
		);
		expect(h).not.toContain("(default)");
		expect(startButton(h)).toContain(`disabled=""`);
	});
	it("shows the default without a change control until providers load", () => {
		const h = render({}, { providers: undefined });
		expect(h).toContain("Anthropic / claude-haiku (default)");
		expect(h).not.toContain(">Change</button>");
	});
});
