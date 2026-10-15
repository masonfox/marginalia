import { asSchema, type FlexibleSchema } from "ai";
import { describe, expect, it } from "vitest";
import { buildBookMapMessage, buildSystemPrompt } from "./prompt";
import type { ConversationBook } from "./repository";
import { createConversationTools, type ToolDeps } from "./tools";

// Prompt caching only works when this prefix is byte-identical between requests.

const opts = { maxSteps: 8 };

const books: ConversationBook[] = [
	{
		editionId: "00000000-0000-0000-0000-000000000001",
		shortId: "abc",
		title: "The Rise of Endymion",
		authors: ["Dan Simmons"],
		ordinal: 0,
		maxPosition: null,
		scopeLabel: null,
	},
];

/** Tool definitions as the provider receives them: name, description, JSON schema, in order. */
async function serializedTools() {
	const tools = createConversationTools({
		db: {},
		retrieval: {},
		books: structuredClone(books),
	} as unknown as ToolDeps);
	const out = [];
	for (const [name, t] of Object.entries(tools)) {
		out.push({
			name,
			description: t.description,
			inputSchema: await asSchema(t.inputSchema as FlexibleSchema).jsonSchema,
		});
	}
	return JSON.stringify(out);
}

describe("request prefix", () => {
	it("builds an identical system prompt for the same books", () => {
		expect(buildSystemPrompt(structuredClone(books), opts)).toBe(
			buildSystemPrompt(structuredClone(books), opts),
		);
	});

	it("builds identical tool definitions across builds", async () => {
		expect(await serializedTools()).toBe(await serializedTools());
	});

	it("sends the tools in a fixed order", () => {
		const tools = createConversationTools({
			db: {},
			retrieval: {},
			books,
		} as unknown as ToolDeps);
		expect(Object.keys(tools)).toEqual([
			"searchBooks",
			"readPassage",
			"readSection",
			"getOutline",
			"lookupObservations",
			"lookupNotes",
		]);
	});
	it("keeps stored maps byte-identical across turns and updates on scope changes", () => {
		const first = {
			unitOrdinal: 0,
			unitLabel: "Chapter 1",
			summary: "A lantern appears.",
		};
		const later = {
			unitOrdinal: 1,
			unitLabel: "Chapter 2",
			summary: "A lantern vanishes.",
		};
		const bounded = [
			{
				...(books[0] as ConversationBook),
				maxPosition: 20,
				scopeLabel: "Chapter 1",
			},
		];
		const maps = { b1: [first] };
		const map = buildBookMapMessage(bounded, maps);
		expect(
			buildBookMapMessage(structuredClone(bounded), structuredClone(maps)),
		).toBe(map);
		expect(map).not.toContain(later.summary);
		const widened = buildBookMapMessage(books, { b1: [first, later] });
		expect(widened).toContain(later.summary);
		expect(widened).not.toBe(map);
	});

	it("keeps a map with a reader correction byte-identical across turns", () => {
		const bounded = [
			{
				...(books[0] as ConversationBook),
				maxPosition: 20,
				scopeLabel: "Chapter 2",
			},
		];
		const maps = {
			b1: [
				{ unitOrdinal: 0, unitLabel: "Chapter 1", summary: "A lantern." },
				{
					unitOrdinal: 1,
					unitLabel: "Chapter 2",
					summary: "The reader's own summary.",
					source: "reader correction" as const,
				},
			],
		};
		expect(
			buildBookMapMessage(structuredClone(bounded), structuredClone(maps)),
		).toBe(buildBookMapMessage(bounded, maps));
	});

	it("keeps the system prompt independent of map content", () => {
		const prompt = buildSystemPrompt(structuredClone(books), opts);
		expect(buildBookMapMessage(books, { b1: [] })).toBeNull();
		expect(prompt).not.toContain("<book_maps>\n");
		expect(prompt).toBe(buildSystemPrompt(structuredClone(books), opts));
	});
});
