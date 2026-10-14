import { asSchema, type FlexibleSchema } from "ai";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";
import type { ConversationBook } from "./repository";
import { createConversationTools, type ToolDeps } from "./tools";

// Prompt caching only works when this prefix is byte-identical between requests.

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
		expect(buildSystemPrompt(structuredClone(books))).toBe(
			buildSystemPrompt(structuredClone(books)),
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
			"getOutline",
		]);
	});
});
