// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ComposerDraft,
	DraftComposer,
	DraftSource,
	NewThreadDraft,
	ThreadAnchor,
} from "#/lib/composer-draft";
import { type ComposerState, useComposer } from "./use-composer";

const mocks = vi.hoisted(() => ({
	check: vi.fn(),
	/** The main composer's saved draft (snapshots here need not pass the schema). */
	saved: null as ComposerDraft | null,
	/** Every other saved draft, by draft ID. */
	store: new Map<string, ComposerDraft | NewThreadDraft>(),
}));
vi.mock("#/fns/conversations", () => ({ checkPassageRefFn: mocks.check }));
vi.mock("#/lib/composer-draft", async (importActual) => {
	const actual = await importActual<typeof import("#/lib/composer-draft")>();
	const newId = actual.newThreadDraftId;
	return {
		...actual,
		loadComposerDraft: (id: string) =>
			mocks.store.get(id) ?? (id === "c1" ? mocks.saved : null),
		saveComposerDraft: (id: string, draft: ComposerDraft) => {
			if (draft.text || draft.attachment) mocks.store.set(id, draft);
			else mocks.store.delete(id);
		},
		clearComposerDraft: (id: string) => mocks.store.delete(id),
		loadNewThreadDraft: (c: string) => mocks.store.get(newId(c)) ?? null,
		saveNewThreadDraft: (c: string, draft: NewThreadDraft) =>
			mocks.store.set(newId(c), draft),
		clearNewThreadDraft: (c: string) => mocks.store.delete(newId(c)),
	};
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ref = { locator: "aaaaaaaaaaaa:v1:3.4" };
const snapshot = { locator: ref.locator, text: "A passage." } as never;

/** A check the test resolves by hand. */
function deferCheck() {
	let resolve: (value: unknown) => void = () => {};
	mocks.check.mockReturnValueOnce(
		new Promise((r) => {
			resolve = r;
		}),
	);
	return (value: unknown) => act(async () => resolve(value));
}

let state: ComposerState;
let root: ReturnType<typeof createRoot>;
let handoff: { ref?: string; hl?: string };
let target: DraftComposer;
let anchor: ThreadAnchor | undefined;
let sources: Map<string, DraftSource>;

function Harness() {
	state = useComposer("c1", {
		target,
		anchor,
		sources,
		books: [],
		aiEnabled: true,
		handoff,
		clearHandoff: () => {},
	});
	return null;
}

const mount = () =>
	act(() => {
		root = createRoot(document.createElement("div"));
		root.render(createElement(Harness));
	});
const rerender = () => act(() => root.render(createElement(Harness)));

beforeEach(() => {
	mocks.check.mockReset();
	mocks.saved = null;
	mocks.store.clear();
	handoff = {};
	target = { kind: "main" };
	anchor = undefined;
	sources = new Map();
});
afterEach(() => act(() => root.unmount()));

describe("useComposer dismissNotice", () => {
	it("lets a quiet restored recheck settle under the long-quote notice", async () => {
		mocks.saved = {
			text: "Hi",
			attachment: { kind: "passage", ref, snapshot },
		};
		const resolve = deferCheck();
		await mount();
		expect(state.blockedReason).toBe("Checking passage…");
		await act(() => state.rejectLongQuote());
		await act(() => state.dismissNotice());
		await resolve({ status: "ok", snapshot });
		expect(state.blockedReason).not.toBe("Checking passage…");
		expect(state.attachment?.kind).toBe("passage");
	});

	it("cancels a normal passage check the long-quote notice replaced", async () => {
		await mount();
		const resolve = deferCheck();
		await act(async () => {
			void state.attachPassage(ref);
		});
		await act(() => state.rejectLongQuote());
		await act(() => state.dismissNotice());
		await resolve({ status: "ok", snapshot });
		expect(state.attachment).toBeNull();
		expect(state.notice).toBeNull();
	});
});

describe("useComposer restored passage", () => {
	const restorePassage = () => {
		mocks.saved = {
			text: "Hi",
			attachment: { kind: "passage", ref, snapshot },
		};
	};

	it("blocks Send until the restored passage's recheck finishes", async () => {
		restorePassage();
		const resolve = deferCheck();
		await mount();
		expect(state.draft).toBe("Hi");
		expect(state.attachment).toEqual({ kind: "passage", ref, snapshot });
		expect(state.blockedReason).toBe("Checking passage…");
		await resolve({ status: "ok", snapshot });
		expect(state.blockedReason).toBeNull();
		expect(state.attachment?.kind).toBe("passage");
	});

	it("drops the restored chip when a superseding check fails", async () => {
		restorePassage();
		const resolveQuiet = deferCheck();
		await mount();
		const resolve = deferCheck();
		await act(async () => {
			void state.attachPassage({ locator: "bbbbbbbbbbbb:v1:1.1" });
		});
		await resolve({ status: "invalid", reason: "not_found" });
		await resolveQuiet({ status: "ok", snapshot });
		expect(state.attachment).toBeNull();
		expect(state.notice?.kind).toBe("invalid");
		expect(state.blockedReason).not.toBe("Checking passage…");
	});

	it("drops the restored chip when an invalid handoff notice is dismissed", async () => {
		restorePassage();
		handoff = { ref: "not a locator" };
		const resolveQuiet = deferCheck();
		await mount();
		expect(state.notice?.kind).toBe("invalid");
		await act(() => state.dismissNotice());
		expect(state.blockedReason).not.toBe("Checking passage…");
		expect(state.attachment).toBeNull();
		await resolveQuiet({ status: "ok", snapshot });
		expect(state.attachment).toBeNull();
	});
});

describe("useComposer per composer", () => {
	const reply = "11111111-1111-4111-8111-111111111111";
	const threadReply = "22222222-2222-4222-8222-222222222222";
	const thread = "33333333-3333-4333-8333-333333333333";
	const quoteOf = (messageId: string): ComposerDraft => ({
		text: "Draft",
		attachment: { kind: "quote", messageId, text: "Quoted." },
	});

	it("restores a Bring to main quote from a thread reply in the main composer", async () => {
		mocks.saved = quoteOf(threadReply);
		sources = new Map([[threadReply, { threadId: thread }]]);
		await mount();
		expect(state.attachment).toEqual({
			kind: "quote",
			quote: { messageId: threadReply, text: "Quoted." },
		});
	});

	it("keeps each composer's draft under its own key and drops a thread quote from elsewhere", async () => {
		mocks.store.set(`c1:thread:${thread}`, quoteOf(reply));
		sources = new Map([[reply, { threadId: null }]]);
		target = { kind: "thread", threadId: thread };
		await mount();
		expect(state.draft).toBe("Draft");
		expect(state.attachment).toBeNull();
		await act(() => state.setDraft("Thread draft"));
		await act(() => root.unmount());
		expect(mocks.store.get(`c1:thread:${thread}`)?.text).toBe("Thread draft");
		expect(mocks.store.has("c1")).toBe(false);
		await mount();
	});

	it("saves the new thread's draft with its anchor, and hands it over to the created thread", async () => {
		anchor = { anchorMessageId: reply, quote: "Anchor text" };
		target = { kind: "new-thread" };
		mocks.store.set("c1:thread:new", { text: "", attachment: null, anchor });
		await mount();
		await act(() => state.setDraft("First question"));
		await act(() => state.clear());
		expect(mocks.store.has("c1:thread:new")).toBe(false);
		// Typing on while the first reply streams, then the thread is created.
		await act(() => state.setDraft("Follow-up"));
		target = { kind: "thread", threadId: thread };
		await rerender();
		expect(state.draft).toBe("Follow-up");
		await act(() => root.unmount());
		expect(mocks.store.has("c1:thread:new")).toBe(false);
		expect(mocks.store.get(`c1:thread:${thread}`)?.text).toBe("Follow-up");
		await mount();
	});

	it("does not save the emptied new-thread draft back after a send", async () => {
		anchor = { anchorMessageId: reply, quote: "Anchor text" };
		target = { kind: "new-thread" };
		await mount();
		await act(() => state.setDraft("First question"));
		await act(() => state.clear());
		await act(() => root.unmount());
		expect(mocks.store.has("c1:thread:new")).toBe(false);
		await mount();
	});
});
