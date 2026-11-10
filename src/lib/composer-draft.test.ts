import { describe, expect, it } from "vitest";
import {
	type ComposerDraft,
	clearComposerDraft,
	clearConversationDrafts,
	clearNewThreadDraft,
	composerDraftKey,
	type DraftSource,
	isQuoteSourceValid,
	loadComposerDraft,
	loadNewThreadDraft,
	type NewThreadDraft,
	newConversationDraftId,
	newThreadDraftId,
	restorableDraft,
	restorableNewThreadDraft,
	saveComposerDraft,
	saveNewThreadDraft,
	threadDraftId,
} from "./composer-draft";

const id = "22222222-2222-4222-8222-222222222222";
const messageId = "11111111-1111-4111-8111-111111111111";
const locator = "3f9a1c07b2de:v1:12.47";

/** An in-memory stand-in for sessionStorage. */
function memoryStorage(): Storage {
	const items = new Map<string, string>();
	return {
		get length() {
			return items.size;
		},
		clear: () => items.clear(),
		getItem: (k) => items.get(k) ?? null,
		key: (i) => [...items.keys()][i] ?? null,
		removeItem: (k) => void items.delete(k),
		setItem: (k, v) => void items.set(k, v),
	};
}

const throwing = new Proxy({} as Storage, {
	get() {
		throw new Error("SecurityError");
	},
});

const passageDraft: ComposerDraft = {
	text: "What does this mean?",
	attachment: {
		kind: "passage",
		ref: { locator, range: { start: 4, end: 11 } },
		snapshot: {
			locator,
			range: { start: 4, end: 11 },
			editionId: "ed1",
			bookTitle: "The Book",
			sectionTitle: null,
			text: "history",
		},
	},
};

describe("composer drafts", () => {
	it("round-trips text with a quote or a passage", () => {
		const storage = memoryStorage();
		const quoteDraft: ComposerDraft = {
			text: "Why?",
			attachment: { kind: "quote", messageId, text: "A claim" },
		};
		saveComposerDraft(id, quoteDraft, storage);
		expect(loadComposerDraft(id, storage)).toEqual(quoteDraft);
		saveComposerDraft(id, passageDraft, storage);
		expect(loadComposerDraft(id, storage)).toEqual(passageDraft);
		expect(loadComposerDraft("other", storage)).toBeNull();
	});

	it("removes the key for an empty draft and on clear", () => {
		const storage = memoryStorage();
		saveComposerDraft(id, { text: "x", attachment: null }, storage);
		saveComposerDraft(id, { text: "", attachment: null }, storage);
		expect(storage.getItem(composerDraftKey(id))).toBeNull();
		saveComposerDraft(id, passageDraft, storage);
		clearComposerDraft(id, storage);
		expect(storage.getItem(composerDraftKey(id))).toBeNull();
	});

	it("keeps the chosen books, even with no text, and drops more than three", () => {
		const storage = memoryStorage();
		const books = [
			{ editionId: "e1", title: "Infinite Jest" },
			{ editionId: "e2", title: "The Pale King" },
		];
		saveComposerDraft(
			newConversationDraftId,
			{ text: "", attachment: null, books },
			storage,
		);
		expect(loadComposerDraft(newConversationDraftId, storage)).toEqual({
			text: "",
			attachment: null,
			books,
		});
		saveComposerDraft(
			newConversationDraftId,
			{ text: "", attachment: null, books: [] },
			storage,
		);
		expect(
			storage.getItem(composerDraftKey(newConversationDraftId)),
		).toBeNull();
		storage.setItem(
			composerDraftKey(newConversationDraftId),
			JSON.stringify({
				v: 1,
				text: "Too many",
				attachment: null,
				books: [1, 2, 3, 4].map((n) => ({
					editionId: `e${n}`,
					title: `Book ${n}`,
				})),
			}),
		);
		expect(loadComposerDraft(newConversationDraftId, storage)).toBeNull();
	});

	it("discards malformed, unknown-version, and over-limit drafts", () => {
		const storage = memoryStorage();
		const key = composerDraftKey(id);
		for (const raw of [
			"{not json",
			JSON.stringify({ v: 2, text: "x", attachment: null }),
			JSON.stringify({ text: "x", attachment: null }),
			JSON.stringify({ v: 1, text: "x".repeat(8001), attachment: null }),
			JSON.stringify({
				v: 1,
				text: "x",
				attachment: { kind: "quote", messageId, text: "q".repeat(2001) },
			}),
			JSON.stringify({
				v: 1,
				text: "x",
				attachment: { kind: "passage", ref: { locator: "bad" } },
			}),
		]) {
			storage.setItem(key, raw);
			expect(loadComposerDraft(id, storage)).toBeNull();
		}
	});

	it("reports whether a draft was stored", () => {
		const storage = memoryStorage();
		expect(saveComposerDraft(id, passageDraft, storage)).toBe(true);
		expect(saveComposerDraft(id, { text: "", attachment: null }, storage)).toBe(
			true,
		);
		const full = memoryStorage();
		full.setItem = () => {
			throw new Error("QuotaExceededError");
		};
		expect(saveComposerDraft(id, passageDraft, full)).toBe(false);
		expect(saveComposerDraft(id, passageDraft, null)).toBe(false);
		expect(saveComposerDraft(id, passageDraft, throwing)).toBe(false);
	});

	it("works without storage", () => {
		expect(loadComposerDraft(id, throwing)).toBeNull();
		expect(() => saveComposerDraft(id, passageDraft, throwing)).not.toThrow();
		expect(() => clearComposerDraft(id, throwing)).not.toThrow();
		expect(loadComposerDraft(id, null)).toBeNull();
	});
});

describe("thread drafts", () => {
	const threadId = "44444444-4444-4444-8444-444444444444";
	const otherThread = "55555555-5555-4555-8555-555555555555";
	const threadReply = "66666666-6666-4666-8666-666666666666";
	const otherReply = "77777777-7777-4777-8777-777777777777";
	const newThread: NewThreadDraft = {
		text: "Say more?",
		attachment: null,
		anchor: { anchorMessageId: messageId, quote: "A claim" },
	};
	/** The conversation's saved assistant messages and their threads. */
	const sources = new Map<string, DraftSource>([
		[messageId, { threadId: null }],
		[threadReply, { threadId }],
		[otherReply, { threadId: otherThread }],
	]);
	const quoting = (source: string): ComposerDraft => ({
		text: "Why?",
		attachment: { kind: "quote", messageId: source, text: "A claim" },
	});

	it("keeps the main, thread, and new-thread drafts apart", () => {
		const storage = memoryStorage();
		saveComposerDraft(id, { text: "main", attachment: null }, storage);
		saveComposerDraft(
			threadDraftId(id, threadId),
			{ text: "thread", attachment: null },
			storage,
		);
		saveNewThreadDraft(id, newThread, storage);
		expect(loadComposerDraft(id, storage)?.text).toBe("main");
		expect(loadComposerDraft(threadDraftId(id, threadId), storage)?.text).toBe(
			"thread",
		);
		expect(loadComposerDraft(threadDraftId(id, otherThread), storage)).toBe(
			null,
		);
		expect(loadNewThreadDraft(id, storage)).toEqual(newThread);
		expect(storage.getItem(composerDraftKey(id))).toContain('"v":1');
	});

	it("saves and restores a new-thread draft with its anchor, even with no text", () => {
		const storage = memoryStorage();
		const empty = { ...newThread, text: "" };
		expect(saveNewThreadDraft(id, empty, storage)).toBe(true);
		expect(loadNewThreadDraft(id, storage)).toEqual(empty);
		const passage = { ...newThread, attachment: passageDraft.attachment };
		saveNewThreadDraft(id, passage, storage);
		expect(loadNewThreadDraft(id, storage)).toEqual(passage);
		clearNewThreadDraft(id, storage);
		expect(loadNewThreadDraft(id, storage)).toBeNull();
	});

	it("keeps a single new-thread draft per conversation", () => {
		const storage = memoryStorage();
		saveNewThreadDraft(id, newThread, storage);
		const second = {
			...newThread,
			anchor: { anchorMessageId: messageId, quote: "Another claim" },
		};
		saveNewThreadDraft(id, second, storage);
		expect(loadNewThreadDraft(id, storage)).toEqual(second);
	});

	it("bumps the format version for the new-thread shape only", () => {
		const storage = memoryStorage();
		saveNewThreadDraft(id, newThread, storage);
		const key = composerDraftKey(newThreadDraftId(id));
		const raw = storage.getItem(key) ?? "";
		expect(JSON.parse(raw).v).toBe(2);
		// A new-thread draft is not a plain draft, and the reverse.
		expect(loadComposerDraft(newThreadDraftId(id), storage)).toBeNull();
		storage.setItem(
			key,
			JSON.stringify({ ...JSON.parse(raw), v: 1, anchor: undefined }),
		);
		expect(loadNewThreadDraft(id, storage)).toBeNull();
		for (const bad of [
			{ ...JSON.parse(raw), v: 3 },
			{ ...JSON.parse(raw), anchor: undefined },
			{ ...JSON.parse(raw), anchor: { anchorMessageId: "x", quote: "q" } },
			{
				...JSON.parse(raw),
				anchor: { anchorMessageId: messageId, quote: " " },
			},
			{
				...JSON.parse(raw),
				anchor: { anchorMessageId: messageId, quote: "x".repeat(2001) },
			},
		]) {
			storage.setItem(key, JSON.stringify(bad));
			expect(loadNewThreadDraft(id, storage)).toBeNull();
		}
		storage.setItem(key, "{not json");
		expect(loadNewThreadDraft(id, storage)).toBeNull();
	});

	it("works without storage", () => {
		expect(loadNewThreadDraft(id, throwing)).toBeNull();
		expect(saveNewThreadDraft(id, newThread, throwing)).toBe(false);
		expect(saveNewThreadDraft(id, newThread, null)).toBe(false);
		expect(() => clearConversationDrafts(id, throwing)).not.toThrow();
	});

	it("clears every draft of a deleted conversation and no other", () => {
		const storage = memoryStorage();
		const other = "88888888-8888-4888-8888-888888888888";
		const draft = { text: "x", attachment: null };
		saveComposerDraft(id, draft, storage);
		saveComposerDraft(threadDraftId(id, threadId), draft, storage);
		saveComposerDraft(threadDraftId(id, otherThread), draft, storage);
		saveNewThreadDraft(id, newThread, storage);
		saveComposerDraft(other, draft, storage);
		saveComposerDraft(threadDraftId(other, threadId), draft, storage);
		clearConversationDrafts(id, storage);
		expect(storage.length).toBe(2);
		expect(loadComposerDraft(other, storage)).toEqual(draft);
		expect(loadComposerDraft(threadDraftId(other, threadId), storage)).toEqual(
			draft,
		);
	});

	it("discards a new-thread draft whose anchor is gone or not a main reply", () => {
		expect(restorableNewThreadDraft(newThread, sources)).toEqual(newThread);
		expect(restorableNewThreadDraft(newThread, new Map())).toBeNull();
		expect(
			restorableNewThreadDraft(
				{
					...newThread,
					anchor: { anchorMessageId: threadReply, quote: "A claim" },
				},
				sources,
			),
		).toBeNull();
		expect(restorableNewThreadDraft(null, sources)).toBeNull();
	});

	it("restores a quote only from a source valid for its composer", () => {
		const main = { kind: "main" } as const;
		const thread = { kind: "thread", threadId } as const;
		// Main: any assistant message in the conversation, in any thread.
		expect(isQuoteSourceValid(main, sources.get(messageId))).toBe(true);
		expect(isQuoteSourceValid(main, sources.get(threadReply))).toBe(true);
		expect(isQuoteSourceValid(main, sources.get(otherReply))).toBe(true);
		// A thread: only its own messages.
		expect(isQuoteSourceValid(thread, sources.get(threadReply))).toBe(true);
		expect(isQuoteSourceValid(thread, sources.get(messageId))).toBe(false);
		expect(isQuoteSourceValid(thread, sources.get(otherReply))).toBe(false);
		// Gone from the conversation.
		expect(isQuoteSourceValid(main, undefined)).toBe(false);
		expect(isQuoteSourceValid(thread, undefined)).toBe(false);

		expect(restorableDraft(quoting(threadReply), main, sources)).toEqual(
			quoting(threadReply),
		);
		expect(restorableDraft(quoting(threadReply), thread, sources)).toEqual(
			quoting(threadReply),
		);
		// An invalid quote is dropped and the text kept.
		expect(restorableDraft(quoting(messageId), thread, sources)).toEqual({
			text: "Why?",
			attachment: null,
		});
		const gone = "99999999-9999-4999-8999-999999999999";
		expect(restorableDraft(quoting(gone), main, sources)).toEqual({
			text: "Why?",
			attachment: null,
		});
		expect(restorableDraft(passageDraft, thread, sources)).toEqual(
			passageDraft,
		);
		// A new thread has no messages of its own to quote.
		expect(
			restorableNewThreadDraft(
				{ ...newThread, attachment: quoting(messageId).attachment },
				sources,
			),
		).toEqual(newThread);
	});
});
