import { describe, expect, it } from "vitest";
import {
	type ComposerDraft,
	clearComposerDraft,
	composerDraftKey,
	loadComposerDraft,
	saveComposerDraft,
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

	it("works without storage", () => {
		expect(loadComposerDraft(id, throwing)).toBeNull();
		expect(() => saveComposerDraft(id, passageDraft, throwing)).not.toThrow();
		expect(() => clearComposerDraft(id, throwing)).not.toThrow();
		expect(loadComposerDraft(id, null)).toBeNull();
	});
});
