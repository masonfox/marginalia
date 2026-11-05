// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { RecentConversation } from "#/modules/conversation";
import { Route } from "./conversations";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	Link: ({ children }: { children: ReactNode }) =>
		createElement("a", { href: "/" }, children),
	useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-start")>()),
	useServerFn: (fn: unknown) => fn,
}));
vi.mock("#/fns/conversations", () => ({
	listRecentConversationsFn: (...args: unknown[]) => mocks.list(...args),
	deleteConversationFn: vi.fn(),
	renameConversationFn: vi.fn(),
	setConversationModelFn: vi.fn(),
}));
vi.mock("#/fns/guide", () => ({
	getReadingPositionFn: vi.fn(),
	setReadingPositionFn: vi.fn(),
}));
vi.mock("#/fns/settings", () => ({ listModelsFn: vi.fn() }));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Observers currently watching the sentinel; reaching the end notifies them. */
const observers = new Set<{ callback: IntersectionObserverCallback }>();

beforeAll(() => {
	globalThis.IntersectionObserver = class {
		constructor(public callback: IntersectionObserverCallback) {}
		observe() {
			observers.add(this);
		}
		unobserve() {}
		disconnect() {
			observers.delete(this);
		}
		takeRecords() {
			return [];
		}
	} as unknown as typeof IntersectionObserver;
});

const conversation = (id: string): RecentConversation => ({
	id,
	title: `Conversation ${id}`,
	createdAt: new Date("2026-11-01T00:00:00Z"),
	updatedAt: new Date("2026-11-01T00:00:00Z"),
	preview: null,
	books: [
		{
			editionId: "e1",
			title: "Middlemarch",
			hasCover: false,
			scopeLabel: null,
		},
	],
});
const page = (ids: string[], nextCursor: string | null = null) => ({
	items: ids.map(conversation),
	nextCursor,
});

/** Answers each cursor with its page, or fails it the given number of times. */
function serve(
	pages: Record<string, ReturnType<typeof page>>,
	failures: Record<string, number> = {},
) {
	mocks.list.mockImplementation(
		async ({ data }: { data: { cursor?: string } }) => {
			const key = data.cursor ?? "first";
			// A request takes a moment, as over the network.
			await new Promise((r) => setTimeout(r, 0));
			if ((failures[key] ?? 0) > 0) {
				failures[key]--;
				throw new Error("offline");
			}
			return pages[key];
		},
	);
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
	mocks.list.mockReset();
	observers.clear();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

/** Lets queries resolve; the query cache notifies on a timer. */
const settle = async () => {
	for (let i = 0; i < 5; i++)
		await act(() => new Promise((r) => setTimeout(r, 0)));
};

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
	await settle();
}

const titles = () =>
	[...container.querySelectorAll('[data-testid="conversation-title"]')].map(
		(el) => el.textContent,
	);
const cursors = () =>
	mocks.list.mock.calls.map(
		([arg]) => (arg as { data: { cursor?: string } }).data.cursor,
	);
/** Scrolls the sentinel into view, as far as the live observers can tell. */
const reachEnd = async () => {
	await act(async () => {
		for (const o of [...observers])
			o.callback(
				[{ isIntersecting: true } as IntersectionObserverEntry],
				o as unknown as IntersectionObserver,
			);
	});
	await settle();
};
const tryAgain = async () => {
	const found = [...container.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Try again",
	);
	if (!found) throw new Error("no Try again");
	await act(async () => found.click());
	await settle();
};

describe("Conversations page", () => {
	it("recovers from a failed first load through Try again", async () => {
		serve({ first: page(["a", "b"]) }, { first: 1 });
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Couldn't load conversations.",
		);
		expect(titles()).toEqual([]);
		await tryAgain();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(titles()).toEqual(["Conversation a", "Conversation b"]);
		expect(cursors()).toEqual([undefined, undefined]);
	});

	it("keeps loaded rows when a later page fails, retries the same page, and resumes paging", async () => {
		serve(
			{
				first: page(["a", "b"], "p2"),
				// The retried page repeats a row already shown.
				p2: page(["b", "c"], "p3"),
				p3: page(["d"]),
			},
			{ p2: 1 },
		);
		await render();
		expect(titles()).toEqual(["Conversation a", "Conversation b"]);

		await reachEnd();
		expect(cursors()).toEqual([undefined, "p2"]);
		expect(titles()).toEqual(["Conversation a", "Conversation b"]);
		expect(container.textContent).toContain(
			"Couldn't load more conversations.",
		);

		// Scrolling on does not ask again by itself.
		await reachEnd();
		await settle();
		expect(cursors()).toEqual([undefined, "p2"]);

		await tryAgain();
		expect(cursors()).toEqual([undefined, "p2", "p2"]);
		expect(container.textContent).not.toContain(
			"Couldn't load more conversations.",
		);
		expect(titles()).toEqual([
			"Conversation a",
			"Conversation b",
			"Conversation c",
		]);

		// Reaching the end loads the next page again.
		await reachEnd();
		expect(cursors()).toEqual([undefined, "p2", "p2", "p3"]);
		expect(titles()).toEqual([
			"Conversation a",
			"Conversation b",
			"Conversation c",
			"Conversation d",
		]);
	});
});
