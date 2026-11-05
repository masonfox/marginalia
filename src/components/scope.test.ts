// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingUnit } from "#/modules/catalog";
import type { ReadingPosition } from "#/modules/guide";
import {
	NewConversationDialog,
	positionChoice,
	ScopeNotice,
	STALE,
	WidenScope,
} from "./scope";

const mocks = vi.hoisted(() => ({
	units: vi.fn(),
	position: vi.fn(),
	create: vi.fn(),
	widen: vi.fn(),
}));
vi.mock("#/fns/conversations", () => ({
	getReadingUnitsFn: mocks.units,
	createConversationFn: mocks.create,
	// No provider, so the dialog offers no model choice.
	getAiStatusFn: vi.fn(async () => ({
		enabled: false,
		providers: [],
		chat: { selection: null, source: "none", available: false },
	})),
	widenScopeFn: mocks.widen,
}));
vi.mock("#/fns/settings", () => ({ listModelsFn: vi.fn() }));
vi.mock("#/fns/guide", () => ({
	getReadingPositionFn: mocks.position,
	setReadingPositionFn: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@tanstack/react-start", () => ({
	useServerFn: (fn: unknown) => fn,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const EDITION = "00000000-0000-4000-8000-000000000000";

const unit = (ordinal: number, start: number, end: number): ReadingUnit => ({
	ordinal,
	label: `Chapter ${ordinal + 1}`,
	path: [`Chapter ${ordinal + 1}`],
	startPosition: start,
	endPosition: end,
	startLocator: `aaaaaaaaaaaa:v1:${ordinal}.0`,
});
const units = [unit(0, 0, 9), unit(1, 10, 19), unit(2, 20, 29)];
const atChapter = (i: number): ReadingPosition => ({
	kind: "unit",
	maxPosition: (units[i] as ReadingUnit).endPosition,
	scopeLabel: (units[i] as ReadingUnit).label,
});

const PARTWAY = "I'm partway through";

/** The button whose text is `text`, or contains it when `partial`. */
function button(within: Element, text: string, partial = false) {
	const found = [...within.querySelectorAll("button")].find((b) =>
		partial ? b.textContent?.includes(text) : b.textContent === text,
	);
	if (!found) throw new Error(`no button "${text}"`);
	return found;
}

const checked = (dialog: Element) =>
	[...dialog.querySelectorAll<HTMLInputElement>("input[type=radio]")].filter(
		(r) => r.checked,
	);

/** A reading position that resolves only when the test says so. */
function deferredPosition() {
	let resolve: (at: ReadingPosition | null) => void = () => {};
	mocks.position.mockReturnValue(
		new Promise<ReadingPosition | null>((r) => {
			resolve = r;
		}),
	);
	return async (at: ReadingPosition | null) => {
		await act(async () => resolve(at));
		await settle();
	};
}

async function settle() {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
}

async function expandPartway(dialog: Element) {
	const expand = [...dialog.querySelectorAll("button")].find((b) =>
		b.textContent?.includes(PARTWAY),
	);
	if (expand) await act(async () => expand.click());
}

async function pick(dialog: Element, value: string) {
	const radio = dialog.querySelector<HTMLInputElement>(
		`input[value="${value}"]`,
	);
	if (!radio) throw new Error(`no radio ${value}`);
	await act(async () => radio.click());
}

describe("positionChoice", () => {
	it("matches whole book when finished, or the unit the position ends at", () => {
		expect(positionChoice(null, units)).toBeNull();
		expect(positionChoice(undefined, units)).toBeNull();
		expect(positionChoice({ kind: "finished" }, [])).toBe("whole");
		expect(positionChoice(atChapter(1), units)).toBe("unit:19");
		// Not offered (a starting passage later than it) or no longer a unit.
		expect(positionChoice(atChapter(1), units.slice(2))).toBeNull();
		expect(
			positionChoice({ kind: "unit", maxPosition: 15, scopeLabel: "x" }, units),
		).toBeNull();
	});
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

async function render(element: ReactElement) {
	const at = document.createElement("div");
	document.body.append(at);
	container = at;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root = createRoot(at);
		root.render(createElement(QueryClientProvider, { client }, element));
	});
	return at;
}

beforeEach(() => {
	mocks.units.mockResolvedValue(units);
	mocks.create.mockReset();
	mocks.widen.mockReset();
});

afterEach(() => {
	if (root) act(() => root?.unmount());
	container?.remove();
	root = container = undefined;
	document.body.innerHTML = "";
});

describe("NewConversationDialog", () => {
	async function open(
		passage?: Parameters<typeof NewConversationDialog>[0]["passage"],
		{ expand = true } = {},
	) {
		await render(
			createElement(NewConversationDialog, {
				editionId: EDITION,
				open: true,
				passage,
			}),
		);
		// Let the queries settle.
		await settle();
		const dialog = document.querySelector(
			"[data-testid=new-conversation-dialog]",
		);
		if (!dialog) throw new Error("dialog not rendered");
		if (expand) await expandPartway(dialog);
		return dialog;
	}

	const start = (dialog: Element) => button(dialog, "Start");

	it("lists the partway choice before whole book", async () => {
		mocks.position.mockResolvedValue(null);
		const dialog = await open(undefined, { expand: false });
		const partway = button(dialog, PARTWAY, true);
		const whole = dialog.querySelector("input[value=whole]");
		if (!whole) throw new Error("no whole-book radio");
		expect(
			partway.compareDocumentPosition(whole) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("names the preselected position once in the collapsed row", async () => {
		mocks.position.mockResolvedValue(atChapter(1));
		const dialog = await open(undefined, { expand: false });
		const row = button(dialog, PARTWAY, true);
		expect(row.textContent).toContain("Through Chapter 2");
		expect(row.textContent).toContain("Your reading position");
		expect(row.textContent?.split("Chapter 2")).toHaveLength(2);
	});

	it("names both units when the selection is not the position", async () => {
		mocks.position.mockResolvedValue(atChapter(1));
		const dialog = await open();
		await pick(dialog, "unit:9");
		const row = button(dialog, PARTWAY, true);
		expect(row.textContent).toContain("Through Chapter 1");
		expect(row.textContent).toContain("Your reading position: Chapter 2");
	});

	it("marks and selects the position's unit", async () => {
		mocks.position.mockResolvedValue(atChapter(1));
		const dialog = await open();
		const marked = dialog.querySelectorAll("[data-reading-position]");
		expect(marked).toHaveLength(1);
		const radio = marked[0]?.querySelector("input");
		expect(radio?.value).toBe("unit:19");
		expect(radio?.getAttribute("aria-label")).toBe(
			"Chapter 2 (your reading position)",
		);
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:19"]);
		expect(
			dialog.querySelector("[data-testid=scope-note]")?.textContent,
		).toContain("“Chapter 2”");
		expect(start(dialog).disabled).toBe(false);
	});

	it("marks and selects whole book when the book is finished", async () => {
		mocks.position.mockResolvedValue({ kind: "finished" });
		const dialog = await open();
		const marked = dialog.querySelectorAll("[data-reading-position]");
		expect(marked).toHaveLength(1);
		expect(marked[0]?.querySelector("input")?.value).toBe("whole");
		expect(checked(dialog).map((r) => r.value)).toEqual(["whole"]);
		expect(dialog.querySelector("[data-testid=spoiler-notice]")).not.toBeNull();
		expect(start(dialog).disabled).toBe(false);
	});

	it("selects the position when it comes after the starting passage", async () => {
		mocks.position.mockResolvedValue(atChapter(2));
		const dialog = await open({
			ref: { locator: "aaaaaaaaaaaa:v1:1.3" },
			revealPosition: 13,
		});
		expect(dialog.querySelectorAll("[data-reading-position]")).toHaveLength(1);
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:29"]);
		expect(start(dialog).disabled).toBe(false);
	});

	it("marks nothing when the position is before the starting passage", async () => {
		mocks.position.mockResolvedValue(atChapter(0));
		const dialog = await open({
			ref: { locator: "aaaaaaaaaaaa:v1:1.3" },
			revealPosition: 13,
		});
		// Chapter 1 is not offered: only units ending at or after the passage are.
		expect(
			[...dialog.querySelectorAll<HTMLInputElement>("input")].map(
				(r) => r.value,
			),
		).toEqual(["unit:19", "unit:29", "whole"]);
		expect(dialog.querySelectorAll("[data-reading-position]")).toHaveLength(0);
		expect(dialog.textContent).not.toContain("Your reading position");
		expect(checked(dialog)).toEqual([]);
		expect(start(dialog).disabled).toBe(true);
	});

	it("marks nothing while the position is unset", async () => {
		mocks.position.mockResolvedValue(null);
		const dialog = await open();
		expect(dialog.querySelectorAll("[data-reading-position]")).toHaveLength(0);
		expect(checked(dialog)).toEqual([]);
		expect(start(dialog).disabled).toBe(true);
	});

	it("submits another unit the reader picks instead", async () => {
		mocks.position.mockResolvedValue(atChapter(1));
		mocks.create.mockResolvedValue({ id: "c1" });
		const dialog = await open();
		await pick(dialog, "unit:9");
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:9"]);
		await act(async () => start(dialog).click());
		expect(mocks.create).toHaveBeenCalledWith({
			data: {
				books: [
					{ editionId: EDITION, scope: { kind: "unit", endPosition: 9 } },
				],
			},
		});
	});

	it("keeps a pick made before the position loads", async () => {
		const resolvePosition = deferredPosition();
		mocks.create.mockResolvedValue({ id: "c1" });
		const dialog = await open();
		await pick(dialog, "unit:9");
		await resolvePosition(atChapter(1));
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:9"]);
		await act(async () => start(dialog).click());
		expect(mocks.create).toHaveBeenCalledWith({
			data: {
				books: [
					{ editionId: EDITION, scope: { kind: "unit", endPosition: 9 } },
				],
			},
		});
	});

	it("asks again rather than reselecting the position after a stale scope", async () => {
		mocks.position.mockResolvedValue(atChapter(1));
		mocks.create.mockResolvedValue({ error: "stale_scope" });
		const dialog = await open();
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:19"]);
		mocks.units.mockClear();
		await act(async () => start(dialog).click());
		await settle();
		// The refetched units still include the position's unit.
		expect(mocks.units).toHaveBeenCalledTimes(1);
		expect(dialog.querySelector("[role=alert]")?.textContent).toBe(STALE);
		expect(checked(dialog)).toEqual([]);
		expect(start(dialog).disabled).toBe(true);
		await pick(dialog, "unit:19");
		expect(start(dialog).disabled).toBe(false);
	});

	it("selects a position that loads after the units", async () => {
		const resolvePosition = deferredPosition();
		const dialog = await open();
		expect(checked(dialog)).toEqual([]);
		await resolvePosition(atChapter(1));
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:19"]);
		expect(start(dialog).disabled).toBe(false);
	});
});

describe("WidenScope", () => {
	// Scoped through Chapter 1, so Chapters 2 and 3 are later.
	async function open() {
		const at = await render(
			createElement(WidenScope, {
				conversationId: "c1",
				disabled: false,
				book: {
					editionId: EDITION,
					shortId: "aaaaaaaaaaaa",
					title: "A Book",
					authors: [],
					ordinal: 0,
					maxPosition: 9,
					scopeLabel: "Chapter 1",
				},
			}),
		);
		await act(async () => button(at, "Widen").click());
		await settle();
		const dialog = document.querySelector("[data-testid=widen-scope-dialog]");
		if (!dialog) throw new Error("dialog not rendered");
		await expandPartway(dialog);
		return dialog;
	}

	const widen = (dialog: Element) => button(dialog, "Widen");

	it("marks and selects a position later than the bound", async () => {
		mocks.position.mockResolvedValue(atChapter(2));
		const dialog = await open();
		const marked = dialog.querySelectorAll("[data-reading-position]");
		expect(marked).toHaveLength(1);
		expect(marked[0]?.querySelector("input")?.value).toBe("unit:29");
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:29"]);
		expect(widen(dialog).disabled).toBe(false);
		mocks.widen.mockResolvedValue({ widened: true });
		await act(async () => widen(dialog).click());
		expect(mocks.widen).toHaveBeenCalledWith({
			data: {
				conversationId: "c1",
				editionId: EDITION,
				scope: { kind: "unit", endPosition: 29 },
			},
		});
	});

	it("selects whole book when the position is finished", async () => {
		mocks.position.mockResolvedValue({ kind: "finished" });
		const dialog = await open();
		expect(checked(dialog).map((r) => r.value)).toEqual(["whole"]);
		expect(widen(dialog).disabled).toBe(false);
	});

	it.each([
		["at the bound", atChapter(0)],
		["unset", null],
	])("selects nothing when the position is %s", async (_, at) => {
		mocks.position.mockResolvedValue(at);
		const dialog = await open();
		expect(dialog.querySelectorAll("[data-reading-position]")).toHaveLength(0);
		expect(checked(dialog)).toEqual([]);
		expect(widen(dialog).disabled).toBe(true);
	});

	it("keeps a pick made before the position loads", async () => {
		const resolvePosition = deferredPosition();
		mocks.widen.mockResolvedValue({ widened: true });
		const dialog = await open();
		await pick(dialog, "unit:19");
		await resolvePosition(atChapter(2));
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:19"]);
		await act(async () => widen(dialog).click());
		expect(mocks.widen).toHaveBeenCalledWith({
			data: {
				conversationId: "c1",
				editionId: EDITION,
				scope: { kind: "unit", endPosition: 19 },
			},
		});
	});

	it("selects a position that loads after the units", async () => {
		const resolvePosition = deferredPosition();
		const dialog = await open();
		expect(checked(dialog)).toEqual([]);
		await resolvePosition(atChapter(2));
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:29"]);
		expect(widen(dialog).disabled).toBe(false);
	});

	it("asks again rather than reselecting the position after a stale scope", async () => {
		mocks.position.mockResolvedValue(atChapter(2));
		mocks.widen.mockResolvedValue({ widened: false, reason: "stale_scope" });
		const dialog = await open();
		expect(checked(dialog).map((r) => r.value)).toEqual(["unit:29"]);
		mocks.units.mockClear();
		await act(async () => widen(dialog).click());
		await settle();
		// The refetched units still include the position's unit.
		expect(mocks.units).toHaveBeenCalledTimes(1);
		expect(dialog.querySelector("[role=alert]")?.textContent).toBe(STALE);
		expect(checked(dialog)).toEqual([]);
		expect(widen(dialog).disabled).toBe(true);
		await pick(dialog, "unit:29");
		expect(widen(dialog).disabled).toBe(false);
	});
});

describe("ScopeNotice", () => {
	async function notice(props: Parameters<typeof ScopeNotice>[0]) {
		const at = await render(createElement(ScopeNotice, props));
		return {
			spoiler: at.querySelector("[data-testid=spoiler-notice]"),
			note: at.querySelector("[data-testid=scope-note]"),
		};
	}

	it("renders nothing without books", async () => {
		const at = await render(createElement(ScopeNotice, { labels: [] }));
		expect(at.textContent).toBe("");
	});

	it("warns that a whole-book book may be revealed", async () => {
		const { spoiler, note } = await notice({
			labels: [null],
			titles: ["The Pale King"],
		});
		expect(spoiler?.textContent).toContain(
			"has access to the whole book, so it may reveal later events",
		);
		expect(note).toBeNull();
	});

	it("notes the scope of a bounded book without a spoiler warning", async () => {
		const { spoiler, note } = await notice({
			labels: ["Chapter 22"],
			titles: ["Infinite Jest"],
		});
		expect(spoiler).toBeNull();
		expect(note?.textContent).toContain("can read only through “Chapter 22”");
		expect(note?.textContent).toContain("may still know the book from its");
	});

	it("names the fully readable and the bounded books when scopes are mixed", async () => {
		const { spoiler, note } = await notice({
			labels: ["Year of Glad", null],
			titles: ["Infinite Jest", "The Pale King"],
		});
		expect(note).toBeNull();
		const text = spoiler?.textContent ?? "";
		expect(text).toContain("may reveal any part of “The Pale King”.");
		expect(text).toContain("“Infinite Jest” only through “Year of Glad”");
		expect(text).not.toContain("whole book");
	});

	it("lists several books in each group of a mixed notice", async () => {
		const { spoiler } = await notice({
			labels: [null, "Chapter 4", null],
			titles: ["The Pale King", "Infinite Jest", "Broom of the System"],
		});
		const text = spoiler?.textContent ?? "";
		expect(text).toContain(
			"any part of “The Pale King” and “Broom of the System”.",
		);
		expect(text).toContain("“Infinite Jest” only through “Chapter 4”");
	});

	it("falls back to the whole-book warning when titles are not given", async () => {
		const { spoiler } = await notice({ labels: ["Chapter 4", null] });
		expect(spoiler?.textContent).toContain("may reveal later events");
	});
});
