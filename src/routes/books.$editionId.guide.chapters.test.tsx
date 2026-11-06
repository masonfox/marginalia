// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideChapter } from "#/modules/guide";
import { Route } from "./books.$editionId.guide.chapters";

const mocks = vi.hoisted(() => ({ chapters: vi.fn(), bounded: false }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	Link: ({
		params,
		children,
	}: {
		params: { locator: string };
		children: ReactNode;
	}) => createElement("a", { href: `/p/${params.locator}` }, children),
}));
vi.mock("#/fns/guide", () => ({ getGuideChaptersFn: mocks.chapters }));
vi.mock("#/components/guide", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/components/guide")>()),
	useGuide: () => ({
		editionId: "ed-1",
		bound: mocks.bounded
			? { choice: { kind: "unit", endPosition: 9 }, label: "First" }
			: { choice: { kind: "whole" }, label: null },
		units: [{ endPosition: 9 }, { endPosition: 19 }],
		preprocessed: true,
		onStaleBound: () => {},
	}),
	GuideCitations: () => null,
}));
// Per-chapter controls render the chapter they were given, so the test can
// check each stays with its own chapter after the order flips.
vi.mock("#/components/guide-corrections", () => ({
	ShowHiddenToggle: () => null,
	CorrectionControls: ({
		item,
		children,
	}: {
		item: { unitLocator: string };
		children: ReactNode;
	}) =>
		createElement(
			"div",
			{ "data-correct": item.unitLocator },
			children as ReactNode,
		),
}));
vi.mock("#/components/guide-notes", () => ({
	AttachedNotes: () => null,
	AddNoteLink: ({ search }: { search: { unit: string } }) =>
		createElement("span", { "data-add-note": search.unit }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const chapter = (ordinal: number, label: string): GuideChapter => ({
	ordinal,
	label,
	locator: `loc-${ordinal}`,
	endPosition: ordinal * 10 + 9,
	summary: {
		text: `Summary of ${label}`,
		citations: [],
		correction: null,
	},
	notes: [],
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
	mocks.chapters.mockReset();
	mocks.bounded = false;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

async function render() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const View = Route.options.component as ComponentType;
	await act(async () => {
		root.render(
			createElement(QueryClientProvider, { client }, createElement(View)),
		);
	});
	await vi.waitFor(async () => {
		await act(async () => {});
		expect(container.querySelector("ol")).not.toBeNull();
	});
}

describe("Chapters view", () => {
	it("marks hidden later sections without revealing their titles or summaries", async () => {
		mocks.bounded = true;
		mocks.chapters.mockResolvedValue({
			ok: true,
			chapters: [chapter(0, "First")],
		});
		await render();
		expect(container.textContent).toContain(
			"Sections past this bound are hidden.",
		);
		expect(
			container.querySelectorAll('[data-testid="guide-chapter"]'),
		).toHaveLength(1);
	});
	it("lists chapters latest first, each keeping its own controls", async () => {
		// The query returns reading order; the view shows the latest first.
		mocks.chapters.mockResolvedValue({
			ok: true,
			chapters: [
				chapter(0, "PART ONE > 1. The Girl"),
				chapter(1, "PART ONE > 2. The Boy"),
				chapter(2, "PART FIVE > 36. The Explorer"),
			],
		});
		await render();

		const items = [
			...container.querySelectorAll('[data-testid="guide-chapter"]'),
		];
		expect(items.map((li) => li.querySelector("h2")?.textContent)).toEqual([
			"PART FIVE > 36. The Explorer",
			"PART ONE > 2. The Boy",
			"PART ONE > 1. The Girl",
		]);
		expect(
			items.map((li) => [
				li.querySelector("[data-correct]")?.getAttribute("data-correct"),
				li.querySelector("[data-add-note]")?.getAttribute("data-add-note"),
				li.querySelector("a")?.getAttribute("href"),
			]),
		).toEqual([
			["loc-2", "loc-2", "/p/loc-2"],
			["loc-1", "loc-1", "/p/loc-1"],
			["loc-0", "loc-0", "/p/loc-0"],
		]);
		expect(items[0]?.textContent).toContain(
			"Summary of PART FIVE > 36. The Explorer",
		);
	});
});
