// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraft } from "#/lib/composer-draft";
import { type ComposerState, useComposer } from "./use-composer";

const mocks = vi.hoisted(() => ({
	check: vi.fn(),
	saved: null as ComposerDraft | null,
}));
vi.mock("#/fns/conversations", () => ({ checkPassageRefFn: mocks.check }));
vi.mock("#/lib/composer-draft", () => ({
	loadComposerDraft: () => mocks.saved,
	saveComposerDraft: () => {},
	clearComposerDraft: () => {},
}));

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

function Harness() {
	state = useComposer("c1", {
		savedAssistantIds: new Set(),
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

beforeEach(() => {
	mocks.check.mockReset();
	mocks.saved = null;
	handoff = {};
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
