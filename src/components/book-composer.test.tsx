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
import type { ReadingUnit } from "#/modules/catalog";
import type { ConversationSummary } from "#/modules/conversation";
import type { ReadingPosition } from "#/modules/guide";
import type { AiStatus } from "#/modules/settings";
import { BookComposer, ScopeSheet, ScopeStrip } from "./book-composer";
import { DiscussView } from "./discuss";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	navigate: vi.fn(),
	reading: null as unknown,
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
vi.mock("#/fns/settings", () => ({ listModelsFn: vi.fn() }));
vi.mock("#/hooks/use-reading-position", async (original) => ({
	...(await original<typeof import("#/hooks/use-reading-position")>()),
	useReadingPosition: () => mocks.reading,
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
});

afterEach(() => {
	act(() => root.unmount());
	document.body.replaceChildren();
});

const render = (node: ReactNode) =>
	act(() =>
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				{node}
			</QueryClientProvider>,
		),
	);

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
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
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
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
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
			data: { editionId: "e1", scope: { kind: "unit", endPosition: 20 } },
		});
		expect(reading.save).not.toHaveBeenCalled();
	});

	it("saves an earlier chapter only after the move-back confirmation", async () => {
		const reading = fakeReading(at(4));
		reading.save.mockResolvedValue("confirm");
		mocks.reading = reading;
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
		await chooseInSheet("Chapter 2", "save");
		expect(reading.save).toHaveBeenCalledWith("unit:20");
		// The hook now waits for confirmation; the composer shows its dialog.
		mocks.reading = { ...reading, pendingMoveBack: "unit:20" };
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
		expect(byTestId("move-back-dialog")?.textContent).toContain(
			"back to Chapter 2",
		);
		expect(byTestId("composer-scope")?.textContent).toBe("Through Chapter 4");
	});

	it("asks for a scope on send with no position, and dismissing creates nothing", async () => {
		mocks.reading = fakeReading(null);
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
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
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
		await type(question(), "Who is Hal?");
		await click(button("Send"));
		await click(button("I'm partway through"));
		await click(radio("Chapter 4"));
		await click(button("Send", sheet()));
		expect(reading.save).toHaveBeenCalledWith("unit:40");
		expect(mocks.create).toHaveBeenCalledWith({
			data: { editionId: "e1", scope: { kind: "unit", endPosition: 40 } },
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
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
		await type(question(), "Question A");
		await click(button("Send"));
		expect(question().readOnly).toBe(true);
		await act(async () => resolve({ id: "c3" }));
		expect(
			JSON.parse(sessionStorage.getItem("marginalia:composer:c3") ?? ""),
		).toMatchObject({ text: "Question A" });
		expect(mocks.navigate).toHaveBeenCalledTimes(1);
	});

	it("unlocks the question for a retry when creation fails", async () => {
		mocks.reading = fakeReading(at(2));
		let reject: (reason: Error) => void = () => {};
		mocks.create.mockReturnValue(
			new Promise((_, r) => {
				reject = r;
			}),
		);
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
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
	});

	it("keeps the message and asks again after a stale choice", async () => {
		mocks.reading = fakeReading(at(2));
		mocks.create.mockResolvedValue({ error: "stale_scope" });
		render(<BookComposer editionId="e1" status={OK_STATUS} />);
		await type(question(), "Still here?");
		await click(button("Send"));
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(byTestId("composer-scope-sheet")?.textContent).toContain(
			"chapters changed",
		);
		expect(question().value).toBe("Still here?");
	});
});

describe("Discuss without a usable model", () => {
	const conversations: ConversationSummary[] = [
		{
			id: "c1",
			title: "On the dictionary",
			createdAt: new Date(),
			updatedAt: new Date(),
			messageCount: 2,
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
