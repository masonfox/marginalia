// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { bookSyncKey } from "#/hooks/use-book-sync";
import type { ReadingPosition } from "#/modules/guide";
import { ReadingPositionControl } from "./reading-position";

interface BookSync {
	source: "manual" | "hardcover" | "bookorbit" | null;
	sourceLabel: string | null;
	reading: Record<string, unknown> | null;
	appliedAt: Date | null;
	movedBackFrom: string | null;
	excluded: boolean;
	linked: boolean;
	links: { kind: "hardcover" | "bookorbit"; label: string; auto: boolean }[];
	pending: "queued" | "active" | null;
}

const mocks = vi.hoisted(() => ({
	reading: null as unknown,
	status: null as unknown,
	getBookSync: vi.fn(),
	syncBook: vi.fn(),
	setExcluded: vi.fn(),
	unlink: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@tanstack/react-start", () => ({
	useServerFn: (fn: unknown) => fn,
}));
vi.mock("#/fns/conversations", () => ({ getReadingUnitsFn: vi.fn() }));
vi.mock("#/fns/settings", () => ({ listModelsFn: vi.fn() }));
vi.mock("#/fns/guide", () => ({
	clearReadingPositionFn: vi.fn(),
	getReadingPositionFn: vi.fn(),
	setReadingPositionFn: vi.fn(),
}));
vi.mock("#/fns/progress-book", () => ({
	getBookSyncFn: (...args: unknown[]) => mocks.getBookSync(...args),
	syncBookFn: (...args: unknown[]) => mocks.syncBook(...args),
	setBookSyncExcludedFn: (...args: unknown[]) => mocks.setExcluded(...args),
}));
vi.mock("#/fns/progress-settings", () => ({
	unlinkBookFn: (...args: unknown[]) => mocks.unlink(...args),
}));
vi.mock("#/hooks/use-reading-position", async (original) => ({
	...(await original<typeof import("#/hooks/use-reading-position")>()),
	useReadingPosition: () => mocks.reading,
}));

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const ID = "00000000-0000-4000-8000-000000000001";
const HOUR = 3_600_000;

const at = (n: number): ReadingPosition => ({
	kind: "unit",
	maxPosition: n * 10,
	scopeLabel: `Chapter ${n}`,
});

/** What useReadingPosition returns; no units, so no "continue reading" link. */
function fakeReading(position: ReadingPosition | null) {
	return {
		position,
		positionStatus: "success",
		units: [],
		unitsStatus: "success",
		progress: null,
		save: vi.fn(),
		clear: vi.fn(),
		pendingMoveBack: null,
		confirmMoveBack: vi.fn(),
		cancelMoveBack: vi.fn(),
		busy: false,
		error: null,
		dismissError: vi.fn(),
	};
}

/** Hardcover's reading of 42% applied two hours ago, unless overridden. */
const synced = (over: Partial<BookSync> = {}): BookSync => ({
	source: "hardcover",
	sourceLabel: "Hardcover",
	reading: { state: "reading", fraction: 0.42 },
	appliedAt: new Date(Date.now() - 2 * HOUR),
	movedBackFrom: null,
	excluded: false,
	linked: true,
	links: [{ kind: "hardcover", label: "Hardcover", auto: true }],
	pending: null,
	...over,
});

const byHand = (over: Partial<BookSync> = {}) =>
	synced({
		source: "manual",
		sourceLabel: null,
		reading: null,
		appliedAt: null,
		...over,
	});

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	client = new QueryClient();
	mocks.getBookSync.mockReset();
	mocks.getBookSync.mockImplementation(async () => mocks.status);
	mocks.syncBook.mockReset();
	mocks.setExcluded.mockReset();
	mocks.unlink.mockReset();
});

afterEach(() => {
	act(() => root.unmount());
	client.clear();
	document.body.replaceChildren();
});

/** Lets queries resolve and effects run. */
const flush = () =>
	act(async () => {
		for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
	});

async function render(
	position: ReadingPosition | null,
	status: BookSync | null,
	compact = false,
) {
	mocks.reading = fakeReading(position);
	mocks.status = status;
	act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<ReadingPositionControl editionId={ID} compact={compact} />
			</QueryClientProvider>,
		),
	);
	await flush();
}

/** Refetches the sync status, as polling a pending sync does. */
const poll = async () => {
	await act(() => client.invalidateQueries({ queryKey: bookSyncKey(ID) }));
	await flush();
};

const text = (id: string) =>
	document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;
const findButton = (name: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name,
	);
const click = async (name: string) => {
	const button = findButton(name);
	if (!button) throw new Error(`no button ${name}`);
	act(() => button.click());
	await flush();
};

describe("Position source", () => {
	it("shows a synced position's provider, reading and age", async () => {
		await render(at(11), synced());
		expect(text("reading-position-value")).toBe("Chapter 11");
		expect(text("position-source")).toBe(
			"Synced from Hardcover · 42% · 2 hours ago",
		);
		expect(text("position-moved-back")).toBeNull();
		expect(mocks.getBookSync).toHaveBeenCalledWith({
			data: { editionId: ID },
		});
	});

	it("shows pages, in the compact hero too", async () => {
		await render(
			at(11),
			synced({
				reading: { state: "reading", pages: { current: 120, total: 300 } },
			}),
			true,
		);
		expect(text("position-source")).toBe(
			"Synced from Hardcover · p. 120 of 300 · 2 hours ago",
		);
	});

	it("says when a sync moved the position back", async () => {
		await render(at(2), synced({ movedBackFrom: "Chapter 14" }));
		expect(text("reading-position-value")).toBe("Chapter 2");
		expect(text("position-moved-back")).toBe("Moved back from Chapter 14");
	});

	it("says when a sync moved back from finished", async () => {
		await render(at(2), synced({ movedBackFrom: "Finished" }));
		expect(text("position-moved-back")).toBe("Moved back from finished");
	});

	it("shows a move back to unset", async () => {
		await render(
			null,
			synced({
				reading: { state: "reading", fraction: 0.03 },
				movedBackFrom: "Chapter 14",
			}),
		);
		expect(text("reading-position-value")).toBe("Not set");
		expect(text("position-source")).toBe(
			"Synced from Hardcover · 3% · 2 hours ago",
		);
		expect(text("position-moved-back")).toBe("Moved back from Chapter 14");
	});

	it("shows a manual edit on a synced book as set by hand", async () => {
		await render(at(5), byHand());
		expect(text("reading-position-value")).toBe("Chapter 5");
		expect(text("position-source")).toBe("Set by hand");
		expect(document.body.textContent).not.toContain("Synced from");
	});

	it("shows nothing about sync for a book without a provider", async () => {
		await render(at(5), byHand({ linked: false, links: [] }));
		expect(text("position-source")).toBeNull();
		expect(findButton("Sync")).toBeUndefined();
		expect(findButton("Exclude from sync")).toBeUndefined();
	});
});

describe("Per-book sync actions", () => {
	it("queues one sync, shows it pending, then its result", async () => {
		await render(at(3), synced());
		mocks.syncBook.mockResolvedValue({ queued: true });
		mocks.status = synced({ pending: "queued" });
		await click("Sync");
		expect(mocks.syncBook).toHaveBeenCalledTimes(1);
		expect(mocks.syncBook).toHaveBeenCalledWith({ data: { editionId: ID } });
		expect(text("book-sync-message")).toBe("Sync queued…");
		expect(findButton("Sync")?.disabled).toBe(true);

		// Clicking again while it is pending queues nothing more.
		await click("Sync");
		expect(mocks.syncBook).toHaveBeenCalledTimes(1);

		mocks.status = synced({ pending: "active" });
		await poll();
		expect(text("book-sync-message")).toBe("Syncing…");

		mocks.status = synced({ appliedAt: new Date() });
		await poll();
		expect(text("book-sync-message")).toBe("Synced: position updated.");
		expect(text("position-source")).toBe(
			"Synced from Hardcover · 42% · just now",
		);
		expect(findButton("Sync")?.disabled).toBe(false);
	});

	it("says when a sync applied nothing new", async () => {
		await render(at(3), synced());
		mocks.syncBook.mockResolvedValue({ queued: true });
		// The job finished before the first check.
		await click("Sync");
		expect(text("book-sync-message")).toBe("Synced: nothing new to apply.");
	});

	it("excludes the book, then behaves like one without a provider", async () => {
		await render(at(3), synced());
		mocks.setExcluded.mockResolvedValue({ updated: true });
		mocks.status = synced({ excluded: true });
		await click("Exclude from sync");
		expect(mocks.setExcluded).toHaveBeenCalledWith({
			data: { editionId: ID, excluded: true },
		});
		expect(text("position-source")).toBeNull();
		expect(findButton("Sync")).toBeUndefined();
		expect(findButton("Exclude from sync")).toBeUndefined();

		mocks.status = synced();
		await click("Include in sync");
		expect(mocks.setExcluded).toHaveBeenLastCalledWith({
			data: { editionId: ID, excluded: false },
		});
		expect(findButton("Sync")).toBeDefined();
		expect(text("position-source")).toBe(
			"Synced from Hardcover · 42% · 2 hours ago",
		);
	});

	it("reports a sync that could not start", async () => {
		await render(at(3), synced());
		mocks.syncBook.mockRejectedValue(new Error("down"));
		await click("Sync");
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not start a sync. Please try again.",
		);
	});
});

describe("Unlink", () => {
	const unlinkedState = () =>
		synced({ linked: false, links: [], source: "hardcover" });

	it("confirms in place, unlinks, and says an auto match will not come back", async () => {
		await render(at(3), synced());
		await click("Unlink from Hardcover");
		expect(mocks.unlink).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain(
			"Unlink this book from Hardcover?",
		);
		expect(findButton("Sync")).toBeUndefined();
		expect(document.activeElement).toBe(findButton("Cancel"));

		mocks.unlink.mockResolvedValue({ unlinked: true });
		mocks.status = unlinkedState();
		const calls = mocks.getBookSync.mock.calls.length;
		await click("Unlink");
		expect(mocks.unlink).toHaveBeenCalledWith({
			data: { editionId: ID, kind: "hardcover" },
		});
		// The control reloads: no more sync actions for an unlinked book.
		expect(mocks.getBookSync.mock.calls.length).toBeGreaterThan(calls);
		expect(findButton("Unlink from Hardcover")).toBeUndefined();
		expect(findButton("Sync")).toBeUndefined();
		expect(text("book-sync-message")).toBe(
			"Unlinked from Hardcover. It won’t be matched to this book again automatically; you can link it by hand in Settings, under Reading sync.",
		);
	});

	it("says only that a hand-made link was removed", async () => {
		await render(
			at(3),
			synced({
				links: [{ kind: "hardcover", label: "Hardcover", auto: false }],
			}),
			true,
		);
		mocks.unlink.mockResolvedValue({ unlinked: true });
		mocks.status = unlinkedState();
		await click("Unlink from Hardcover");
		await click("Unlink");
		expect(text("book-sync-message")).toBe("Unlinked from Hardcover.");
	});

	it("offers one unlink per provider, and cancel keeps the link", async () => {
		await render(
			at(3),
			synced({
				links: [
					{ kind: "bookorbit", label: "BookOrbit", auto: true },
					{ kind: "hardcover", label: "Hardcover", auto: false },
				],
			}),
		);
		expect(findButton("Unlink from BookOrbit")).toBeDefined();
		await click("Unlink from Hardcover");
		await click("Cancel");
		expect(mocks.unlink).not.toHaveBeenCalled();
		expect(findButton("Sync")).toBeDefined();
		expect(findButton("Unlink from Hardcover")).toBeDefined();
	});

	it("offers unlink on an excluded book", async () => {
		await render(at(3), synced({ excluded: true }));
		expect(findButton("Include in sync")).toBeDefined();
		expect(findButton("Unlink from Hardcover")).toBeDefined();
	});

	it("reports an unlink that failed and keeps asking", async () => {
		await render(at(3), synced());
		mocks.unlink.mockRejectedValue(new Error("down"));
		await click("Unlink from Hardcover");
		await click("Unlink");
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not unlink this book from Hardcover.",
		);
		expect(findButton("Unlink")).toBeDefined();
	});
});
