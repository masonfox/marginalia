// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingUnit } from "#/modules/catalog";
import type { ReadingPosition } from "#/modules/guide";
import { NewConversationDialog, positionChoice } from "./scope";

const mocks = vi.hoisted(() => ({
	units: vi.fn(),
	position: vi.fn(),
}));
vi.mock("#/fns/conversations", () => ({
	getReadingUnitsFn: mocks.units,
	createConversationFn: vi.fn(),
	// No provider, so the dialog offers no model choice.
	getAiStatusFn: vi.fn(async () => ({
		enabled: false,
		providers: [],
		chat: { selection: null, source: "none", available: false },
	})),
	widenScopeFn: vi.fn(),
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

describe("NewConversationDialog", () => {
	let root: ReturnType<typeof createRoot>;
	let container: HTMLDivElement;

	beforeEach(() => {
		mocks.units.mockResolvedValue(units);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		document.body.innerHTML = "";
	});

	async function open(
		passage?: Parameters<typeof NewConversationDialog>[0]["passage"],
	) {
		container = document.createElement("div");
		document.body.append(container);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		await act(async () => {
			root = createRoot(container);
			root.render(
				createElement(
					QueryClientProvider,
					{ client },
					createElement(NewConversationDialog, {
						editionId: "00000000-0000-4000-8000-000000000000",
						open: true,
						passage,
					}),
				),
			);
		});
		// Let both queries settle.
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
		const dialog = document.querySelector(
			"[data-testid=new-conversation-dialog]",
		);
		if (!dialog) throw new Error("dialog not rendered");
		const expand = [...dialog.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("I'm partway through"),
		);
		if (expand) await act(async () => expand.click());
		return dialog;
	}

	const start = (dialog: Element) =>
		[...dialog.querySelectorAll("button")].find(
			(b) => b.textContent === "Start",
		) as HTMLButtonElement;
	const checked = (dialog: Element) =>
		[...dialog.querySelectorAll<HTMLInputElement>("input[type=radio]")].filter(
			(r) => r.checked,
		);

	it("marks the position's unit without selecting it", async () => {
		mocks.position.mockResolvedValue(atChapter(1));
		const dialog = await open();
		const marked = dialog.querySelectorAll("[data-reading-position]");
		expect(marked).toHaveLength(1);
		const radio = marked[0]?.querySelector("input");
		expect(radio?.value).toBe("unit:19");
		expect(radio?.getAttribute("aria-label")).toBe(
			"Chapter 2 (your reading position)",
		);
		expect(dialog.textContent).toContain("Your reading position: Chapter 2");
		expect(checked(dialog)).toEqual([]);
		expect(start(dialog).disabled).toBe(true);
	});

	it("marks whole book when the book is finished, still unselected", async () => {
		mocks.position.mockResolvedValue({ kind: "finished" });
		const dialog = await open();
		const marked = dialog.querySelectorAll("[data-reading-position]");
		expect(marked).toHaveLength(1);
		expect(marked[0]?.querySelector("input")?.value).toBe("whole");
		expect(checked(dialog)).toEqual([]);
		expect(start(dialog).disabled).toBe(true);
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
		).toEqual(["whole", "unit:19", "unit:29"]);
		expect(dialog.querySelectorAll("[data-reading-position]")).toHaveLength(0);
		expect(dialog.textContent).not.toContain("Your reading position");
	});

	it("marks nothing while the position is unset", async () => {
		mocks.position.mockResolvedValue(null);
		const dialog = await open();
		expect(dialog.querySelectorAll("[data-reading-position]")).toHaveLength(0);
		expect(checked(dialog)).toEqual([]);
	});
});
