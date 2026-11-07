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
import type { Choice } from "#/components/scope";
import { newConversationDraftId } from "#/lib/composer-draft";
import type { ReadingUnit } from "#/modules/catalog";
import type { ConversationSummary } from "#/modules/conversation";
import type { ReadingPosition } from "#/modules/guide";
import type { AiStatus } from "#/modules/settings";
import {
	BookComposer,
	Composer,
	ScopeSheet,
	ScopeStrip,
} from "./book-composer";
import { DiscussView } from "./discuss";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	navigate: vi.fn(),
	reading: null as unknown,
	/** Reading positions by book; books not listed use `reading`. */
	readings: {} as Record<string, unknown>,
	shelf: vi.fn(),
	edition: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
	}: {
		children: ReactNode;
		className?: string;
	}) => (
		<a href="/" className={className}>
			{children}
		</a>
	),
	useNavigate: () => mocks.navigate,
	useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@tanstack/react-start", () => ({
	useServerFn: (fn: unknown) => fn,
}));
vi.mock("#/fns/conversations", () => ({
	createConversationFn: (...args: unknown[]) => mocks.create(...args),
	checkPassageRefFn: vi.fn(),
	deleteConversationFn: vi.fn(),
	getAiStatusFn: vi.fn(),
	getReadingUnitsFn: vi.fn(),
	listConversationsFn: vi.fn(),
	renameConversationFn: vi.fn(),
	setConversationModelFn: vi.fn(),
	widenScopeFn: vi.fn(),
}));
vi.mock("#/fns/guide", () => ({
	clearReadingPositionFn: vi.fn(),
	getReadingPositionFn: vi.fn(),
	setReadingPositionFn: vi.fn(),
}));
vi.mock("#/fns/settings", () => ({
	listModelsFn: vi.fn(),
	getDiscussionPromptFn: vi.fn(async () => ({
		mode: "default",
		text: "policy",
	})),
}));
vi.mock("#/fns/library", () => ({
	listShelfFn: (...args: unknown[]) => mocks.shelf(...args),
	getEditionFn: (...args: unknown[]) => mocks.edition(...args),
}));
vi.mock("#/hooks/use-reading-position", async (original) => ({
	...(await original<typeof import("#/hooks/use-reading-position")>()),
	useReadingPosition: (editionId: string) =>
		mocks.readings[editionId] ?? mocks.reading,
}));

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	window.matchMedia ??= ((query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {},
	})) as unknown as typeof window.matchMedia;
});

const unit = (n: number): ReadingUnit => ({
	ordinal: n - 1,
	label: `Chapter ${n}`,
	path: [`Chapter ${n}`],
	startPosition: n * 10 - 9,
	endPosition: n * 10,
	startLocator: `x.${n}`,
});
const UNITS = [1, 2, 3, 4, 5].map(unit);
const at = (n: number): ReadingPosition => ({
	kind: "unit",
	maxPosition: n * 10,
	scopeLabel: `Chapter ${n}`,
});

/** What useReadingPosition returns, with spies for what the composer calls. */
function fakeReading(
	position: ReadingPosition | null,
	overrides: Record<string, unknown> = {},
) {
	return {
		position,
		positionStatus: "success",
		units: UNITS,
		unitsStatus: "success",
		progress: null,
		save: vi.fn(async (_: Choice) => "saved"),
		clear: vi.fn(),
		pendingMoveBack: null as Choice | null,
		confirmMoveBack: vi.fn(),
		cancelMoveBack: vi.fn(),
		busy: false,
		error: null,
		dismissError: vi.fn(),
		...overrides,
	};
}

const OK_STATUS: AiStatus = {
	enabled: true,
	providers: ["openai"],
	chat: {
		selection: { provider: "openai", model: "gpt-test" },
		available: true,
	},
	preprocess: { selection: null, available: false, sameAsChat: true },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	sessionStorage.clear();
	mocks.create.mockReset();
	mocks.navigate.mockReset();
	mocks.shelf.mockReset();
	mocks.edition.mockReset();
	mocks.readings = {};
});

afterEach(() => {
	act(() => root.unmount());
	document.body.replaceChildren();
	Reflect.deleteProperty(document, "execCommand");
});

/** jsdom has no execCommand: refuse in-place edits so list shortcuts fall back to setting the value. */
const refuseExecCommand = () => {
	const execCommand = vi.fn(() => false);
	Object.defineProperty(document, "execCommand", {
		configurable: true,
		value: execCommand,
	});
	return execCommand;
};

const render = (node: ReactNode) => {
	const client = new QueryClient();
	client.setQueryData(["discussion-prompt"], {
		mode: "default",
		text: "policy",
	});
	return act(() =>
		root.render(
			<QueryClientProvider client={client}>{node}</QueryClientProvider>,
		),
	);
};
const byTestId = (id: string) =>
	document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
/** A button by its accessible name, or the start of its text. */
const button = (name: string, within: ParentNode = document) => {
	const found = [...within.querySelectorAll("button")].find((b) => {
		const label = b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "";
		return label === name || label.startsWith(name);
	});
	if (!found) throw new Error(`no button ${name}`);
	return found;
};
const radio = (name: string) => {
	const found = [
		...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
	].find(
		(r) =>
			(r.getAttribute("aria-label") ?? r.parentElement?.textContent?.trim()) ===
			name,
	);
	if (!found) throw new Error(`no radio ${name}`);
	return found;
};
const sheet = () => {
	const el = byTestId("composer-scope-sheet");
	if (!el) throw new Error("no sheet");
	return el;
};
const click = (el: HTMLElement) => act(async () => el.click());

/** Types into a React-controlled textarea. */
const type = (el: HTMLTextAreaElement, text: string) =>
	act(async () => {
		const set = Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set;
		set?.call(el, text);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
/** Dispatches a cancelable keydown to the element. */
const pressKey = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
	act(() => {
		el.dispatchEvent(
			new KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
const question = () => {
	const el = document.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Your question"]',
	);
	if (!el) throw new Error("no composer");
	return el;
};

describe("ScopeStrip", () => {
	const strip = (state: Parameters<typeof ScopeStrip>[0]["state"]) =>
		render(
			<ScopeStrip state={state} onChange={() => {}} onUsePosition={() => {}} />,
		);

	it("shows a unit position with the training note", () => {
		strip({ kind: "unit", label: "Chapter 12", once: false });
		expect(byTestId("composer-scope")?.textContent).toBe("Through Chapter 12");
		expect(byTestId("scope-note")?.textContent).toContain(
			"may still know the book from its training",
		);
		expect(byTestId("spoiler-notice")).toBeNull();
		expect(button("Update")).toBeTruthy();
	});

	it("shows a finished position as the whole book with the spoiler notice", () => {
		strip({ kind: "whole", once: false });
		expect(byTestId("composer-scope")?.textContent).toBe("Whole book");
		expect(byTestId("spoiler-notice")?.textContent).toContain(
			"may reveal later events",
		);
		expect(byTestId("scope-note")).toBeNull();
	});

	it("asks how far the reader has read when the position is unset", () => {
		strip({ kind: "unset" });
		expect(byTestId("composer-scope-strip")?.textContent).toContain(
			"How far have you read?",
		);
		expect(byTestId("composer-scope")).toBeNull();
		expect(button("Choose")).toBeTruthy();
	});

	it("labels a one-off scope and offers the way back", () => {
		strip({ kind: "unit", label: "Chapter 3", once: true });
		expect(byTestId("composer-scope")?.textContent).toBe(
			"Through Chapter 3 · this conversation only",
		);
		expect(button("Use my position")).toBeTruthy();
	});
});

describe("ScopeSheet", () => {
	it("offers saving (selected) or this conversation only, with the shared caveat", async () => {
		const onModeChange = vi.fn();
		render(
			<ScopeSheet
				open
				onOpenChange={() => {}}
				units={UNITS}
				position={"unit:20"}
				choice={null}
				onChoiceChange={() => {}}
				mode="save"
				onModeChange={onModeChange}
				sending={false}
				busy={false}
				error={null}
				onConfirm={() => {}}
			/>,
		);
		expect(radio("Save as my reading position").checked).toBe(true);
		expect(radio("Only for this conversation").checked).toBe(false);
		expect(byTestId("composer-scope-sheet")?.textContent).toContain(
			"shared by everyone using this Marginalia instance",
		);
		expect(button("Use this scope").disabled).toBe(true);
		await click(radio("Only for this conversation"));
		expect(onModeChange).toHaveBeenCalledWith("once");
	});
});

describe("BookComposer", () => {
	const chooseInSheet = async (label: string, mode: "save" | "once") => {
		await click(button("Update"));
		await click(button("I'm partway through"));
		await click(radio(label));
		await click(
			radio(
				mode === "save"
					? "Save as my reading position"
					: "Only for this conversation",
			),
		);
		await click(button("Use this scope"));
	};

	it("restores the tab's draft", async () => {
		mocks.reading = fakeReading(at(2));
		sessionStorage.setItem(
			"marginalia:composer:book:e1",
			JSON.stringify({ v: 1, text: "Half a question", attachment: null }),
		);
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		expect(question().value).toBe("Half a question");
		await type(question(), "Half a question, finished");
		expect(
			JSON.parse(sessionStorage.getItem("marginalia:composer:book:e1") ?? "")
				.text,
		).toBe("Half a question, finished");
	});

	it("uses an earlier chapter once without saving or asking to move back", async () => {
		const reading = fakeReading(at(4));
		mocks.reading = reading;
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		expect(byTestId("composer-scope")?.textContent).toBe("Through Chapter 4");
		await chooseInSheet("Chapter 2", "once");
		expect(reading.save).not.toHaveBeenCalled();
		expect(byTestId("composer-scope")?.textContent).toBe(
			"Through Chapter 2 · this conversation only",
		);
		expect(byTestId("move-back-dialog")).toBeNull();

		await click(button("Use my position"));
		expect(byTestId("composer-scope")?.textContent).toBe("Through Chapter 4");

		await chooseInSheet("Chapter 2", "once");
		mocks.create.mockResolvedValue({ id: "c1" });
		await type(question(), "Why?");
		await click(button("Send"));
		expect(mocks.create).toHaveBeenCalledWith({
			data: {
				books: [{ editionId: "e1", scope: { kind: "unit", endPosition: 20 } }],
			},
		});
		expect(reading.save).not.toHaveBeenCalled();
	});

	it("saves an earlier chapter only after the move-back confirmation", async () => {
		const reading = fakeReading(at(4));
		reading.save.mockResolvedValue("confirm");
		mocks.reading = reading;
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		await chooseInSheet("Chapter 2", "save");
		expect(reading.save).toHaveBeenCalledWith("unit:20");
		// The hook now waits for confirmation; the composer shows its dialog.
		mocks.reading = { ...reading, pendingMoveBack: "unit:20" };
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		expect(byTestId("move-back-dialog")?.textContent).toContain(
			"back to Chapter 2",
		);
		expect(byTestId("composer-scope")?.textContent).toBe("Through Chapter 4");
	});

	it("asks for a scope on send with no position, and dismissing creates nothing", async () => {
		mocks.reading = fakeReading(null);
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		await type(question(), "Who is Hal?");
		await click(button("Send"));
		expect(
			[...sheet().querySelectorAll<HTMLInputElement>("input[type=radio]")]
				.filter((r) => r.checked)
				.map((r) => r.value),
		).toEqual(["save"]);
		expect(button("Send", sheet()).disabled).toBe(true);
		await click(button("Cancel"));
		expect(byTestId("composer-scope-sheet")).toBeNull();
		expect(mocks.create).not.toHaveBeenCalled();
		expect(question().value).toBe("Who is Hal?");
	});

	it("saves the chosen position, then creates and opens the conversation with the message", async () => {
		const reading = fakeReading(null);
		mocks.reading = reading;
		mocks.create.mockResolvedValue({ id: "c9" });
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		await type(question(), "Who is Hal?");
		await click(button("Send"));
		await click(button("I'm partway through"));
		await click(radio("Chapter 4"));
		await click(button("Send", sheet()));
		expect(reading.save).toHaveBeenCalledWith("unit:40");
		expect(mocks.create).toHaveBeenCalledWith({
			data: {
				books: [{ editionId: "e1", scope: { kind: "unit", endPosition: 40 } }],
			},
		});
		expect(
			JSON.parse(sessionStorage.getItem("marginalia:composer:c9") ?? ""),
		).toMatchObject({ text: "Who is Hal?" });
		const [{ state, ...to }] = mocks.navigate.mock.calls[0] as [
			{ state: (prev: object) => object },
		];
		expect(to).toEqual({
			to: "/c/$conversationId",
			params: { conversationId: "c9" },
		});
		expect(state({})).toEqual({ autoSend: true });
	});

	it("locks the question while the conversation is being created", async () => {
		mocks.reading = fakeReading(at(2));
		let resolve: (value: { id: string }) => void = () => {};
		mocks.create.mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		const execCommand = refuseExecCommand();
		const bookDraft = () =>
			JSON.parse(
				sessionStorage.getItem("marginalia:composer:book:e1") ?? "null",
			);
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		await type(question(), "- Question A");
		await click(button("Send"));
		expect(question().readOnly).toBe(true);
		// List shortcuts would otherwise indent and continue the locked question.
		question().setSelectionRange(12, 12);
		pressKey(question(), "Tab");
		pressKey(question(), "Enter", { shiftKey: true });
		expect(question().value).toBe("- Question A");
		expect(bookDraft()).toMatchObject({ text: "- Question A" });
		expect(execCommand).not.toHaveBeenCalled();
		let navigated = false;
		mocks.navigate.mockImplementation(async () => {
			expect(bookDraft()).toMatchObject({ text: "- Question A" });
			navigated = true;
		});
		await act(async () => resolve({ id: "c3" }));
		expect(
			JSON.parse(sessionStorage.getItem("marginalia:composer:c3") ?? ""),
		).toMatchObject({ text: "- Question A" });
		expect(mocks.navigate).toHaveBeenCalledTimes(1);
		expect(navigated).toBe(true);
		expect(bookDraft()).toBeNull();
	});

	it("unlocks the question for a retry when creation fails", async () => {
		mocks.reading = fakeReading(at(2));
		let reject: (reason: Error) => void = () => {};
		mocks.create.mockReturnValue(
			new Promise((_, r) => {
				reject = r;
			}),
		);
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		await type(question(), "Question A");
		await click(button("Send"));
		expect(question().readOnly).toBe(true);
		await act(async () => reject(new Error("offline")));
		expect(question().readOnly).toBe(false);
		expect(question().value).toBe("Question A");
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain(
			"Could not start a conversation",
		);
		// List shortcuts edit again once unlocked.
		refuseExecCommand();
		await type(question(), "- Question A");
		question().setSelectionRange(12, 12);
		pressKey(question(), "Tab");
		expect(question().value).toBe("  - Question A");
	});

	describe("when the question cannot be saved for the new conversation", () => {
		const conversationKey = (id: string) => `marginalia:composer:${id}`;
		const bookKey = conversationKey("book:e1");
		const handedOver = (id: string) =>
			JSON.parse(sessionStorage.getItem(conversationKey(id)) ?? "null");
		const expectKeptHere = (text: string) => {
			expect(question().value).toBe(text);
			expect(question().readOnly).toBe(false);
			expect(mocks.navigate).not.toHaveBeenCalled();
			expect(document.querySelector('[role="alert"]')?.textContent).toContain(
				"Could not pass your question to the new conversation",
			);
		};

		afterEach(() => vi.restoreAllMocks());

		it("keeps the question when every write throws, and a retry reuses the conversation", async () => {
			mocks.reading = fakeReading(at(2));
			mocks.create.mockResolvedValue({ id: "c1" });
			render(
				<BookComposer
					editionId="e1"
					title="Infinite Jest"
					status={OK_STATUS}
				/>,
			);
			await type(question(), "Who is Hal?");
			const setItem = vi
				.spyOn(Storage.prototype, "setItem")
				.mockImplementation(() => {
					throw new DOMException("full", "QuotaExceededError");
				});
			await click(button("Send"));
			expect(mocks.create).toHaveBeenCalledTimes(1);
			expect(handedOver("c1")).toBeNull();
			expectKeptHere("Who is Hal?");

			// Storage recovers: the retry hands over to the same conversation.
			setItem.mockRestore();
			await click(button("Send"));
			expect(mocks.create).toHaveBeenCalledTimes(1);
			expect(handedOver("c1")).toMatchObject({ text: "Who is Hal?" });
			expect(mocks.navigate).toHaveBeenCalledTimes(1);
			expect(mocks.navigate.mock.calls[0][0]).toMatchObject({
				params: { conversationId: "c1" },
			});
			expect(sessionStorage.getItem(bookKey)).toBeNull();
		});

		it("keeps the book draft when only the conversation's write fails", async () => {
			mocks.reading = fakeReading(at(2));
			mocks.create.mockResolvedValue({ id: "c1" });
			render(
				<BookComposer
					editionId="e1"
					title="Infinite Jest"
					status={OK_STATUS}
				/>,
			);
			await type(question(), "Who is Hal?");
			expect(JSON.parse(sessionStorage.getItem(bookKey) ?? "")).toMatchObject({
				text: "Who is Hal?",
			});
			const original = Storage.prototype.setItem;
			vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
				this: Storage,
				key: string,
				value: string,
			) {
				if (key === conversationKey("c1"))
					throw new DOMException("full", "QuotaExceededError");
				original.call(this, key, value);
			});
			await click(button("Send"));
			expectKeptHere("Who is Hal?");
			expect(handedOver("c1")).toBeNull();
			expect(JSON.parse(sessionStorage.getItem(bookKey) ?? "")).toMatchObject({
				text: "Who is Hal?",
			});

			// An edited question goes to the same conversation on retry.
			await type(question(), "Who is Hal, really?");
			await click(button("Send"));
			expect(mocks.create).toHaveBeenCalledTimes(1);
			expectKeptHere("Who is Hal, really?");
		});

		it("keeps the question when session storage is blocked, and a new scope creates afresh", async () => {
			mocks.reading = fakeReading(at(4));
			mocks.create
				.mockResolvedValueOnce({ id: "c1" })
				.mockResolvedValueOnce({ id: "c2" });
			render(
				<BookComposer
					editionId="e1"
					title="Infinite Jest"
					status={OK_STATUS}
				/>,
			);
			await type(question(), "Who is Hal?");
			const blocked = vi
				.spyOn(window, "sessionStorage", "get")
				.mockImplementation(() => {
					throw new DOMException("denied", "SecurityError");
				});
			await click(button("Send"));
			expect(mocks.create).toHaveBeenCalledTimes(1);
			expectKeptHere("Who is Hal?");

			// The first conversation was made for chapter 4; chapter 2 needs its own.
			await chooseInSheet("Chapter 2", "once");
			blocked.mockRestore();
			await click(button("Send"));
			expect(mocks.create).toHaveBeenCalledTimes(2);
			expect(mocks.create.mock.calls[1][0]).toEqual({
				data: {
					books: [
						{ editionId: "e1", scope: { kind: "unit", endPosition: 20 } },
					],
				},
			});
			expect(handedOver("c2")).toMatchObject({ text: "Who is Hal?" });
			expect(mocks.navigate.mock.calls[0][0]).toMatchObject({
				params: { conversationId: "c2" },
			});
		});
	});

	it("keeps the message and asks again after a stale choice", async () => {
		mocks.reading = fakeReading(at(2));
		mocks.create.mockResolvedValue({ error: "stale_scope", editionId: "e1" });
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		await type(question(), "Still here?");
		await click(button("Send"));
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(byTestId("composer-scope-sheet")?.textContent).toContain(
			"chapters changed",
		);
		expect(question().value).toBe("Still here?");
	});
});

describe("Composer with several books", () => {
	const IJ = { editionId: "e1", title: "Infinite Jest" };
	const PK = { editionId: "e2", title: "The Pale King" };
	const BROOM = { editionId: "e3", title: "The Broom of the System" };
	const shelfItem = (
		book: { editionId: string; title: string },
		status = "not-started",
	) => ({
		id: book.editionId,
		title: book.title,
		authors: ["David Foster Wallace"],
		status,
		error: null,
		hasCover: false,
	});
	const page = (items: unknown[], nextCursor: string | null = null) => ({
		items,
		nextCursor,
		total: null,
		matching: null,
		needsAttention: null,
		processing: null,
	});

	const row = (editionId: string) => {
		const el = document.querySelector<HTMLElement>(
			`[data-testid="composer-book"][data-edition-id="${editionId}"]`,
		);
		if (!el) throw new Error(`no book ${editionId}`);
		return el;
	};
	const scopeOf = (editionId: string) =>
		row(editionId).querySelector('[data-testid="composer-scope"]')?.textContent;
	const titles = () =>
		[...document.querySelectorAll('[data-testid="composer-book-title"]')].map(
			(el) => el.textContent,
		);
	const sendButton = () =>
		[...document.querySelectorAll("form button")].at(-1) as HTMLButtonElement;
	const requestedBooks = () =>
		(mocks.create.mock.calls[0]?.[0] as { data: { books: unknown[] } }).data
			.books;
	const composer = (initialBooks = [IJ, PK], draftId = "book:e1") =>
		render(
			<Composer
				initialBooks={initialBooks}
				draftId={draftId}
				status={OK_STATUS}
			/>,
		);
	const typeSearch = (text: string) =>
		act(async () => {
			const input = document.querySelector<HTMLInputElement>(
				'input[aria-label="Search books"]',
			);
			if (!input) throw new Error("no search");
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, text);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	const options = () =>
		[
			...document.querySelectorAll<HTMLButtonElement>(
				'[data-testid="book-picker-option"]',
			),
		].map((b) => b.querySelector("span")?.textContent);
	/** Lets queries resolve; the query cache notifies on a timer. */
	const settle = async () => {
		for (let i = 0; i < 5; i++)
			await act(() => new Promise((r) => setTimeout(r, 0)));
	};
	/** Opens the picker and lets its pages load. */
	const openPicker = async () => {
		await click(button("Add book"));
		await settle();
	};
	const pick = async (title: string) => {
		const found = [
			...document.querySelectorAll<HTMLButtonElement>(
				'[data-testid="book-picker-option"]',
			),
		].find((b) => b.querySelector("span")?.textContent === title);
		if (!found) throw new Error(`no option ${title}`);
		await click(found);
	};

	beforeAll(() => {
		// The picker's sentinel is always in view in these tests.
		globalThis.IntersectionObserver ??= class {
			constructor(private callback: IntersectionObserverCallback) {}
			observe() {
				this.callback(
					[{ isIntersecting: true } as IntersectionObserverEntry],
					this as unknown as IntersectionObserver,
				);
			}
			unobserve() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		} as unknown as typeof IntersectionObserver;
	});

	it("uses selected shelf cover metadata without reloading the edition", () => {
		render(
			<Composer
				initialBooks={[
					{ ...IJ, hasCover: true, authors: ["David Foster Wallace"] },
				]}
				draftId="cover-book"
				status={OK_STATUS}
			/>,
		);
		expect(
			row("e1")
				.querySelector('[data-testid="composer-book-cover"] img')
				?.getAttribute("src"),
		).toBe("/api/covers/e1");
		expect(mocks.edition).not.toHaveBeenCalled();
		expect(scopeOf("e1")).toBeTruthy();
	});

	it("keeps a preselected slot stable while its cover metadata loads", async () => {
		let resolve: (value: unknown) => void = () => {};
		mocks.edition.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		composer([IJ]);
		const slot = row("e1");
		expect(
			slot.querySelector('[data-testid="composer-book-cover"] [role="img"]'),
		).not.toBeNull();
		expect(
			slot.querySelector('[data-testid="composer-book-cover"] img'),
		).toBeNull();
		expect(button("Remove Infinite Jest")).toBeTruthy();
		await act(async () => {
			resolve({
				edition: { coverPath: "cover.jpg", authors: ["David Foster Wallace"] },
			});
		});
		await vi.waitFor(() =>
			expect(slot.querySelector("img")?.getAttribute("src")).toBe(
				"/api/covers/e1",
			),
		);
		expect(row("e1")).toBe(slot);
		expect(scopeOf("e1")).toBeTruthy();
	});

	it("explains why starting is blocked and prevents submission", async () => {
		composer();
		const submit = button("Start conversation");
		expect(submit.type).toBe("submit");
		expect(submit.getAttribute("aria-disabled")).toBe("true");
		const reason = document.getElementById(
			submit.getAttribute("aria-describedby") ?? "",
		);
		expect(reason?.textContent).toBe("Type a message");
		await click(submit);
		expect(mocks.create).not.toHaveBeenCalled();
		await type(question(), "Compare them");
		expect(submit.hasAttribute("aria-disabled")).toBe(false);
		expect(submit.hasAttribute("aria-describedby")).toBe(false);
	});

	it("keeps the starting reason accessible and prevents duplicate starts", async () => {
		mocks.create.mockReturnValue(new Promise(() => {}));
		composer();
		await type(question(), "Compare them");
		const submit = button("Start conversation");
		await click(submit);
		expect(submit.getAttribute("aria-disabled")).toBe("true");
		expect(
			document.getElementById(submit.getAttribute("aria-describedby") ?? "")
				?.textContent,
		).toBe("Starting the conversation…");
		await click(submit);
		expect(mocks.create).toHaveBeenCalledTimes(1);
	});

	it("sends each book with its own position, in the order they were added", async () => {
		mocks.readings = {
			e1: fakeReading(at(4)),
			e2: fakeReading({ kind: "finished" }),
		};
		mocks.create.mockResolvedValue({ id: "c1" });
		composer();
		expect(titles()).toEqual(["Infinite Jest", "The Pale King"]);
		expect(scopeOf("e1")).toBe("Through Chapter 4");
		expect(scopeOf("e2")).toBe("Whole book");
		await type(question(), "Compare them");
		await click(button("Start conversation"));
		expect(mocks.create).toHaveBeenCalledWith({
			data: {
				books: [
					{ editionId: "e1", scope: { kind: "unit", endPosition: 40 } },
					{ editionId: "e2", scope: { kind: "whole" } },
				],
			},
		});
	});

	it("changes one book's scope for this conversation only, leaving the other's", async () => {
		const ij = fakeReading(at(4));
		const pk = fakeReading(at(3));
		mocks.readings = { e1: ij, e2: pk };
		mocks.create.mockResolvedValue({ id: "c1" });
		composer();
		await click(button("Update", row("e1")));
		expect(sheet().textContent).toContain(
			"How far have you read in Infinite Jest?",
		);
		await click(button("I'm partway through"));
		await click(radio("Chapter 2"));
		await click(radio("Only for this conversation"));
		await click(button("Use this scope"));
		expect(scopeOf("e1")).toBe("Through Chapter 2 · this conversation only");
		expect(scopeOf("e2")).toBe("Through Chapter 3");
		expect(ij.save).not.toHaveBeenCalled();
		expect(pk.save).not.toHaveBeenCalled();
		await type(question(), "Why?");
		await click(button("Start conversation"));
		expect(requestedBooks()).toEqual([
			{ editionId: "e1", scope: { kind: "unit", endPosition: 20 } },
			{ editionId: "e2", scope: { kind: "unit", endPosition: 30 } },
		]);
	});

	it("asks only for the book without a position, then sends with both", async () => {
		const pk = fakeReading(null);
		mocks.readings = { e1: fakeReading(at(2)), e2: pk };
		mocks.create.mockResolvedValue({ id: "c1" });
		composer();
		await type(question(), "Who is Hal?");
		await click(button("Start conversation"));
		expect(sheet().textContent).toContain(
			"How far have you read in The Pale King?",
		);
		expect(mocks.create).not.toHaveBeenCalled();
		await click(button("I'm partway through"));
		await click(radio("Chapter 4"));
		await click(button("Send", sheet()));
		expect(pk.save).toHaveBeenCalledWith("unit:40");
		expect(requestedBooks()).toEqual([
			{ editionId: "e1", scope: { kind: "unit", endPosition: 20 } },
			{ editionId: "e2", scope: { kind: "unit", endPosition: 40 } },
		]);
	});

	it("asks for each book without a position in turn", async () => {
		mocks.readings = { e1: fakeReading(null), e2: fakeReading(null) };
		mocks.create.mockResolvedValue({ id: "c1" });
		composer();
		await type(question(), "Who is Hal?");
		await click(button("Start conversation"));
		expect(sheet().textContent).toContain("in Infinite Jest?");
		await click(radio("Whole book"));
		await click(radio("Only for this conversation"));
		// Another book is waiting, so this one does not send yet.
		await click(button("Use this scope", sheet()));
		expect(mocks.create).not.toHaveBeenCalled();
		expect(sheet().textContent).toContain("in The Pale King?");
		await click(button("I'm partway through"));
		await click(radio("Chapter 1"));
		await click(radio("Only for this conversation"));
		await click(button("Send", sheet()));
		expect(requestedBooks()).toEqual([
			{ editionId: "e1", scope: { kind: "whole" } },
			{ editionId: "e2", scope: { kind: "unit", endPosition: 10 } },
		]);
	});

	it("creates nothing when the second book's choices are dismissed, keeping the question and books", async () => {
		mocks.readings = { e1: fakeReading(at(2)), e2: fakeReading(null) };
		composer();
		await type(question(), "Who is Hal?");
		await click(button("Start conversation"));
		await click(button("Cancel", sheet()));
		expect(byTestId("composer-scope-sheet")).toBeNull();
		expect(mocks.create).not.toHaveBeenCalled();
		expect(question().value).toBe("Who is Hal?");
		expect(titles()).toEqual(["Infinite Jest", "The Pale King"]);
		// Sending again asks again.
		await click(button("Start conversation"));
		expect(sheet().textContent).toContain("in The Pale King?");
	});

	it("asks again for the book whose scope went stale", async () => {
		mocks.readings = { e1: fakeReading(at(2)), e2: fakeReading(at(3)) };
		mocks.create
			.mockResolvedValueOnce({ error: "stale_scope", editionId: "e2" })
			.mockResolvedValueOnce({ id: "c1" });
		composer();
		await type(question(), "Still here?");
		await click(button("Start conversation"));
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(sheet().textContent).toContain("in The Pale King?");
		expect(sheet().textContent).toContain("chapters changed");
		await click(button("I'm partway through"));
		await click(radio("Chapter 5"));
		await click(button("Send", sheet()));
		expect(mocks.create.mock.calls[1]?.[0]).toEqual({
			data: {
				books: [
					{ editionId: "e1", scope: { kind: "unit", endPosition: 20 } },
					{ editionId: "e2", scope: { kind: "unit", endPosition: 50 } },
				],
			},
		});
	});

	it("names the book that is no longer available", async () => {
		mocks.readings = { e1: fakeReading(at(2)), e2: fakeReading(at(3)) };
		mocks.create.mockResolvedValue({ error: "not_ready", editionId: "e2" });
		composer();
		await type(question(), "Hello?");
		await click(button("Start conversation"));
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			"The Pale King is no longer available",
		);
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("cannot send without a book and asks for one", async () => {
		mocks.reading = fakeReading(at(2));
		composer([], newConversationDraftId);
		expect(byTestId("composer-no-book")?.textContent).toContain("Add a book");
		await type(question(), "Which book is this from?");
		expect(sendButton().getAttribute("aria-disabled")).toBe("true");
		expect(sendButton().title).toBe("Add a book");
		await click(sendButton());
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("offers only ready books not already added, and adds the picked one", async () => {
		mocks.reading = fakeReading(at(2));
		mocks.shelf.mockResolvedValue(
			page([
				shelfItem(IJ, "reading"),
				shelfItem({ editionId: "p1", title: "Processing" }, "processing"),
				shelfItem({ editionId: "f1", title: "Failed" }, "failed"),
				shelfItem(PK),
			]),
		);
		mocks.create.mockResolvedValue({ id: "c1" });
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		// The only book on its own page stays.
		expect(() => button("Remove Infinite Jest")).toThrow();
		await openPicker();
		expect(byTestId("book-picker")).toBeTruthy();
		expect(options()).toEqual(["The Pale King"]);
		await pick("The Pale King");
		expect(byTestId("book-picker")).toBeNull();
		expect(titles()).toEqual(["Infinite Jest", "The Pale King"]);
		expect(button("Remove Infinite Jest")).toBeTruthy();
		await type(question(), "Compare");
		await click(button("Send"));
		expect(requestedBooks()).toEqual([
			{ editionId: "e1", scope: { kind: "unit", endPosition: 20 } },
			{ editionId: "e2", scope: { kind: "unit", endPosition: 20 } },
		]);
	});

	it("searches by the typed query and loads past pages of unusable books", async () => {
		mocks.reading = fakeReading(at(2));
		mocks.shelf.mockImplementation(
			async ({ data }: { data: { q?: string; cursor?: string } }) =>
				data.cursor === undefined
					? page([shelfItem(IJ)], "next")
					: page([shelfItem(BROOM)]),
		);
		composer([IJ], newConversationDraftId);
		await openPicker();
		await settle();
		// The first page held only a book already added; the next one was loaded.
		expect(mocks.shelf).toHaveBeenCalledWith({
			data: { q: undefined, cursor: "next" },
		});
		expect(options()).toEqual(["The Broom of the System"]);
		await typeSearch("pale");
		await settle();
		expect(mocks.shelf).toHaveBeenCalledWith({
			data: { q: "pale", cursor: undefined },
		});
	});

	it("keeps loaded books when a later page fails, and retries that page", async () => {
		mocks.reading = fakeReading(at(2));
		let failed = false;
		mocks.shelf.mockImplementation(
			async ({ data }: { data: { cursor?: string } }) => {
				// A request takes a moment, as over the network, so the picker sees it in flight.
				await new Promise((r) => setTimeout(r, 0));
				if (data.cursor === undefined)
					return page(
						[
							shelfItem(IJ),
							shelfItem({ editionId: "p1", title: "Processing" }, "processing"),
						],
						"p2",
					);
				if (data.cursor === "p2") return page([shelfItem(PK)], "p3");
				if (!failed) {
					failed = true;
					throw new Error("offline");
				}
				return page([shelfItem(BROOM)]);
			},
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		await act(() =>
			root.render(
				<QueryClientProvider client={client}>
					<Composer
						initialBooks={[IJ]}
						draftId={newConversationDraftId}
						status={OK_STATUS}
					/>
				</QueryClientProvider>,
			),
		);
		await openPicker();
		await settle();
		// The failed page leaves the loaded books, a way to retry, and no further requests.
		expect(options()).toEqual(["The Pale King"]);
		expect(byTestId("book-picker")?.textContent).toContain(
			"Couldn't load more books.",
		);
		const cursors = () =>
			mocks.shelf.mock.calls.map(
				([arg]) => (arg as { data: { cursor?: string } }).data.cursor,
			);
		await settle();
		expect(cursors()).toEqual([undefined, "p2", "p3"]);
		await click(button("Try again", byTestId("book-picker") ?? document));
		await settle();
		// The same page was asked for again.
		expect(cursors()).toEqual([undefined, "p2", "p3", "p3"]);
		expect(options()).toEqual(["The Pale King", "The Broom of the System"]);
		expect(byTestId("book-picker")?.textContent).not.toContain(
			"Couldn't load more books.",
		);
	});

	it("removes a book before sending, and hides Add book at three books", async () => {
		mocks.reading = fakeReading(at(2));
		mocks.create.mockResolvedValue({ id: "c1" });
		composer([IJ, PK, BROOM], newConversationDraftId);
		expect(() => button("Add book")).toThrow();
		const remove = button("Remove The Broom of the System");
		// A native button, so the keyboard reaches and operates it.
		expect(remove.tagName).toBe("BUTTON");
		expect(remove.tabIndex).toBe(0);
		await click(remove);
		expect(button("Add book")).toBeTruthy();
		await click(button("Remove The Pale King"));
		expect(titles()).toEqual(["Infinite Jest"]);
		// Nothing pins the last book outside its own page.
		expect(button("Remove Infinite Jest")).toBeTruthy();
		await type(question(), "Just one");
		await click(button("Start conversation"));
		expect(requestedBooks()).toEqual([
			{ editionId: "e1", scope: { kind: "unit", endPosition: 20 } },
		]);
	});

	it("restores the chosen books and the question, dropping books no longer ready", async () => {
		mocks.reading = fakeReading(at(2));
		mocks.shelf.mockResolvedValue(page([shelfItem(IJ), shelfItem(PK)]));
		composer([], newConversationDraftId);
		await openPicker();
		await pick("Infinite Jest");
		await openPicker();
		await pick("The Pale King");
		await type(question(), "Half a question");
		act(() => root.unmount());
		root = createRoot(container);

		// Reopened: The Pale King was deleted in the meantime.
		mocks.edition.mockImplementation(
			async ({ data }: { data: { editionId: string } }) =>
				data.editionId === "e1" ? { edition: { status: "ready" } } : null,
		);
		composer([], newConversationDraftId);
		expect(question().value).toBe("Half a question");
		await settle();
		expect(titles()).toEqual(["Infinite Jest"]);
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("keeps the book page's draft without books until another is added", async () => {
		mocks.reading = fakeReading(at(2));
		mocks.shelf.mockResolvedValue(page([shelfItem(PK)]));
		mocks.edition.mockResolvedValue({ edition: { status: "ready" } });
		const stored = () =>
			JSON.parse(sessionStorage.getItem("marginalia:composer:book:e1") ?? "");
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		await type(question(), "Hi");
		expect(stored().books).toBeUndefined();
		await openPicker();
		await pick("The Pale King");
		expect(stored().books).toEqual([IJ, PK]);
		act(() => root.unmount());
		root = createRoot(container);
		render(
			<BookComposer editionId="e1" title="Infinite Jest" status={OK_STATUS} />,
		);
		await settle();
		expect(titles()).toEqual(["Infinite Jest", "The Pale King"]);
		expect(question().value).toBe("Hi");
	});
});

describe("Discuss without a usable model", () => {
	const conversations: ConversationSummary[] = [
		{
			id: "c1",
			title: "On the dictionary",
			createdAt: new Date(),
			updatedAt: new Date(),
			scopeLabel: "Chapter 2",
			preview: "Hal is reading the dictionary because",
		},
	];

	it.each([
		[
			"AI is not configured",
			{
				...OK_STATUS,
				enabled: false,
				providers: [],
				chat: { selection: null, available: false },
			},
		],
		[
			"The chat default is unavailable",
			{
				...OK_STATUS,
				chat: { selection: OK_STATUS.chat.selection, available: false },
			},
		],
	] as const)("shows %j instead of the composer, and still the list", (title, status) => {
		mocks.reading = fakeReading(at(2));
		render(
			<DiscussView
				editionId="e1"
				title="Infinite Jest"
				isReady
				status={status as AiStatus}
				conversations={conversations}
			/>,
		);
		expect(byTestId("ai-setup")?.querySelector("h2")?.textContent).toBe(title);
		expect(byTestId("book-composer")).toBeNull();
		expect(byTestId("conversation-preview")?.textContent).toBe(
			"Hal is reading the dictionary because",
		);
	});
});
