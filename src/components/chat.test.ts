import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	AiSetupNotice,
	modelInEffect,
	SourcesList,
	SourcesScope,
	UserMarkdown,
	type VerifiedCitation,
} from "./chat";

const router = createRouter({
	routeTree: createRootRoute(),
	history: createMemoryHistory(),
});

/** Renders the list inside a message's sources scope, or alone when `scope` is null. */
function render(
	sources: VerifiedCitation[],
	scope: { defaultOpen?: boolean } | null = {},
) {
	const list = createElement(SourcesList, { sources });
	// These tests are plain .ts, so children go through props rather than JSX.
	const children = scope
		? // biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
			createElement(SourcesScope, { ...scope, children: list })
		: list;
	return renderToStaticMarkup(
		createElement(RouterContextProvider, { router, children }),
	);
}

const source = (
	n: number,
	bookTitle = "The Great Gatsby",
): VerifiedCitation => ({
	editionId: "ed1",
	locator: `ab:v1:0.${n}`,
	currentLocator: `ab:v1:0.${n}`,
	quote: `quote number ${n}`,
	status: "verified",
	bookTitle,
	sectionTitle: `Chapter ${n}`,
});

const sources = [source(1), source(2), source(3)];

describe("SourcesList", () => {
	it("renders nothing without sources", () => {
		expect(render([])).toBe("");
	});

	it("is collapsed by default to a count and the cited books", () => {
		for (const html of [render(sources), render(sources, null)]) {
			expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
			expect(html).toContain("Sources (3)");
			expect(html).toContain("· The Great Gatsby");
			expect(html).not.toContain("quote number 1");
		}
	});

	it("lists every source in citation order when expanded", () => {
		const html = render(sources, { defaultOpen: true });
		expect(html).toMatch(/<button[^>]*aria-expanded="true"/);
		const quotes = [...html.matchAll(/quote number (\d)/g)].map((m) => m[1]);
		// Each quote appears in the row and its title.
		expect([...new Set(quotes)]).toEqual(["1", "2", "3"]);
		expect(html).toContain('href="/p/ab%3Av1%3A0.2"');
		// One book: rows show only the chapter, not the book again.
		expect(html).toContain("Chapter 2 →");
		expect(html).not.toContain("The Great Gatsby · Chapter 2 →");
	});

	it("names the book on each row when sources span books", () => {
		const html = render([source(1), source(2, "Moby-Dick")], {
			defaultOpen: true,
		});
		expect(html).toContain("· The Great Gatsby, Moby-Dick");
		expect(html).toContain("Moby-Dick · Chapter 2 →");
	});
});

describe("UserMarkdown", () => {
	const html = (text: string) =>
		renderToStaticMarkup(createElement(UserMarkdown, { text }));

	it("renders lists and emphasis as markdown", () => {
		const out = html("Two thoughts:\n\n1. **first**\n2. second");
		expect(out).toContain("<ol");
		expect(out).toContain("<strong>first</strong>");
	});

	it("shows raw HTML as text and never renders it", () => {
		const out = html("<img src=x onerror=alert(1)> and <b>x</b>");
		expect(out).not.toContain("<img");
		expect(out).not.toContain("<b>");
		expect(out).toContain("&lt;img src=x onerror=alert(1)&gt; and &lt;b&gt;x");
		expect(html("<div>\nblock\n</div>")).toContain("&lt;div&gt;");
	});

	it("does not treat citation markers as citations", () => {
		const out = html('See [[cite locator="x:v1:0.0" quote="q"]]');
		expect(out).not.toContain("data-citation-status");
	});
});

describe("modelInEffect", () => {
	const anthropic = { provider: "anthropic" as const, model: "claude-x" };
	const openai = { provider: "openai" as const, model: "gpt-x" };
	const status = (
		providers: ("anthropic" | "openai")[],
		chat: typeof anthropic | null,
	) => ({
		enabled: providers.length > 0,
		providers,
		chat: {
			selection: chat,
			available: chat !== null && providers.includes(chat.provider),
		},
	});

	it("is disabled without any provider, even with an override", () => {
		expect(modelInEffect(status([], null), anthropic)).toEqual({
			status: "disabled",
		});
	});
	it("follows the chat default, labelled as the default", () => {
		expect(modelInEffect(status(["anthropic"], anthropic), null)).toEqual({
			status: "ok",
			selection: anthropic,
			own: false,
		});
	});
	it("uses the conversation's own model over the default", () => {
		expect(
			modelInEffect(status(["anthropic", "openai"], anthropic), openai),
		).toEqual({ status: "ok", selection: openai, own: true });
	});
	it("reports a missing default when providers exist but none is set", () => {
		expect(modelInEffect(status(["anthropic"], null), null)).toEqual({
			status: "no_default",
		});
	});
	it("reports an unavailable model instead of using another", () => {
		expect(modelInEffect(status(["anthropic"], anthropic), openai)).toEqual({
			status: "unavailable",
			selection: openai,
			own: true,
		});
	});
});

describe("AiSetupNotice", () => {
	const notice = (effect: Parameters<typeof AiSetupNotice>[0]["effect"]) =>
		renderToStaticMarkup(
			createElement(RouterContextProvider, {
				router,
				// biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
				children: createElement(AiSetupNotice, { effect }),
			}),
		);

	it("without a provider, points to Settings", () => {
		const html = notice({ status: "disabled" });
		expect(html).toContain("AI is not configured");
		expect(html).toContain('href="/settings"');
		expect(html).toContain("Add a provider");
		expect(html).not.toContain("AI_API_KEY");
		expect(html).not.toContain("restart");
	});
	it("with providers but no chat default, points to Settings", () => {
		const html = notice({ status: "no_default" });
		expect(html).toContain("No chat model is chosen");
		expect(html).toContain('href="/settings"');
		expect(html).not.toContain("AI is not configured");
		expect(html).not.toContain("AI_ANTHROPIC_API_KEY");
	});
	it("names an unavailable model", () => {
		const own = notice({
			status: "unavailable",
			selection: { provider: "openai", model: "gpt-x" },
			own: true,
		});
		expect(own).toContain("This conversation&#x27;s model is unavailable");
		expect(own).toContain("OpenAI / gpt-x");
		const fallback = notice({
			status: "unavailable",
			selection: { provider: "openai", model: "gpt-x" },
			own: false,
		});
		expect(fallback).toContain("The chat default is unavailable");
		expect(fallback).toContain('href="/settings"');
	});
});
