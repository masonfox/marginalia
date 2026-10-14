import { tool } from "ai";
import { z } from "zod";
import { getToc, type TocNode } from "#/modules/catalog";
import type { Retrieval } from "#/modules/retrieval";
import type { Executor } from "#/server/db";
import type { ConversationBook } from "./repository";

/** Hard limits so a tool call can never flood the model's context. */
export const LIMITS = {
	searchResults: 10,
	defaultSearchResults: 5,
	snippetChars: 400,
	passageChars: 2000,
	context: 5,
	outlineEntries: 150,
	resultChars: 8000,
} as const;

export interface ToolDeps {
	db: Executor;
	retrieval: Retrieval;
	/** The conversation's books. Tools cannot reach any edition outside this set. */
	books: ConversationBook[];
}

/** Short handle for a book in prompts and tool arguments: `b1`, `b2`, ... */
export const bookHandle = (b: { ordinal: number }) => `b${b.ordinal + 1}`;

const clip = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max - 1)}…`;

function selectBooks(deps: ToolDeps, handle: string | undefined) {
	if (handle === undefined) return { books: deps.books };
	const wanted = handle.trim().toLowerCase();
	const book = deps.books.find((b) => bookHandle(b) === wanted);
	if (!book) {
		return {
			error: {
				status: "unknown_book" as const,
				message: `No book "${handle}" in this conversation.`,
				books: deps.books.map((b) => ({
					book: bookHandle(b),
					title: b.title,
				})),
			},
		};
	}
	return { books: [book] };
}

/** Caps the serialized result size by dropping trailing items. */
function capItems<T>(items: T[], maxChars: number = LIMITS.resultChars) {
	const kept: T[] = [];
	let size = 0;
	for (const item of items) {
		size += JSON.stringify(item).length;
		if (size > maxChars) break;
		kept.push(item);
	}
	return { items: kept, truncated: kept.length < items.length };
}

export async function searchBooks(
	deps: ToolDeps,
	args: { query: string; book?: string; limit?: number },
) {
	const selected = selectBooks(deps, args.book);
	if (selected.error) return selected.error;
	const limit = Math.min(
		args.limit ?? LIMITS.defaultSearchResults,
		LIMITS.searchResults,
	);
	const handles = new Map(selected.books.map((b) => [b.editionId, b]));
	const hits = await deps.retrieval.search({
		query: args.query,
		limit,
		editionIds: selected.books.map((b) => ({
			editionId: b.editionId,
			maxPosition: b.maxPosition ?? undefined,
		})),
	});
	const results = hits.map((h) => {
		const book = handles.get(h.editionId);
		return {
			book: book ? bookHandle(book) : null,
			bookTitle: h.editionTitle,
			locator: h.locator,
			section: h.sectionTitle,
			position: h.position,
			text: clip(h.snippet.map((p) => p.text).join(""), LIMITS.snippetChars),
		};
	});
	const capped = capItems(results);
	return {
		status: "ok" as const,
		count: capped.items.length,
		truncated: capped.truncated,
		results: capped.items,
	};
}

export async function readPassage(
	deps: ToolDeps,
	args: { locator: string; context?: number },
) {
	const context = Math.min(Math.max(args.context ?? 0, 0), LIMITS.context);
	const result = await deps.retrieval.resolve(args.locator, { context });
	if (result.status === "not_found") {
		return { status: "not_found" as const, locator: result.requestedLocator };
	}
	const book = deps.books.find((b) => b.editionId === result.edition.id);
	if (!book) {
		return {
			status: "not_in_conversation" as const,
			locator: result.requestedLocator,
		};
	}
	if (result.status === "removed") {
		return { status: "removed" as const, locator: result.requestedLocator };
	}
	const bound = book.maxPosition;
	const visible = (p: { revealPosition: number }) =>
		bound === null || p.revealPosition <= bound;
	if (!visible(result.passage)) {
		return {
			status: "not_found" as const,
			locator: result.requestedLocator,
		};
	}
	const shape = (p: (typeof result)["passage"]) => ({
		locator: p.locator,
		kind: p.kind,
		text: clip(p.text, LIMITS.passageChars),
	});
	const neighbours = (list: (typeof result)["before"]) =>
		capItems(list.filter(visible).map(shape), LIMITS.resultChars / 2).items;
	return {
		status: "ok" as const,
		superseded: result.superseded,
		book: bookHandle(book),
		bookTitle: result.edition.title,
		section: result.section.title,
		path: result.tocPath,
		passage: shape(result.passage),
		before: neighbours(result.before),
		after: neighbours(result.after),
	};
}

/**
 * The TOC entries revealed at or before `bound`. An entry beyond it is
 * dropped with its children; an entry without a passage stays only if a
 * visible descendant or later sibling remains.
 */
function boundedToc(nodes: TocNode[], bound: number | null): TocNode[] {
	if (bound === null) return nodes;
	const kept: TocNode[] = [];
	for (const n of [...nodes].reverse()) {
		if (n.revealPosition !== null) {
			if (n.revealPosition <= bound)
				kept.unshift({ ...n, children: boundedToc(n.children, bound) });
			continue;
		}
		const children = boundedToc(n.children, bound);
		if (children.length > 0 || kept.length > 0)
			kept.unshift({ ...n, children });
	}
	return kept;
}

export async function getOutline(deps: ToolDeps, args: { book?: string }) {
	const selected = selectBooks(deps, args.book);
	if (selected.error) return selected.error;
	const outlines = await Promise.all(
		selected.books.map(async (b) => {
			const entries: {
				title: string;
				depth: number;
				locator: string | null;
			}[] = [];
			const walk = (nodes: TocNode[], depth: number) => {
				for (const n of nodes) {
					entries.push({ title: n.label, depth, locator: n.locator });
					walk(n.children, depth + 1);
				}
			};
			walk(boundedToc(await getToc(deps.db, b.editionId), b.maxPosition), 0);
			const capped = entries.slice(0, LIMITS.outlineEntries);
			const sized = capItems(capped);
			return {
				book: bookHandle(b),
				bookTitle: b.title,
				entries: sized.items,
				truncated: sized.truncated || entries.length > capped.length,
				...(b.scopeLabel !== null && {
					scope: b.scopeLabel,
					continuesBeyondScope: true,
				}),
			};
		}),
	);
	return { status: "ok" as const, outlines };
}

/** The tools exposed to the model, scoped to the conversation's books. */
export function createConversationTools(deps: ToolDeps) {
	const bookArg = z
		.string()
		.optional()
		.describe(
			"Book handle such as b1. Omit to use every book in the conversation.",
		);
	return {
		searchBooks: tool({
			description:
				"Full-text search over the conversation's books. Returns matching passages with locators you can cite. Use short keyword queries or quoted phrases.",
			inputSchema: z.object({
				query: z.string().min(1).max(300),
				book: bookArg,
				limit: z.number().int().min(1).max(LIMITS.searchResults).optional(),
			}),
			execute: (args) => searchBooks(deps, args),
		}),
		readPassage: tool({
			description:
				"Read one passage by locator, optionally with neighbouring passages for context. Use before quoting or making claims about a scene.",
			inputSchema: z.object({
				locator: z.string().min(1).max(200),
				context: z.number().int().min(0).max(LIMITS.context).optional(),
			}),
			execute: (args) => readPassage(deps, args),
		}),
		getOutline: tool({
			description:
				"The table of contents of a book (section titles with the locator of their first passage), for navigating its structure. For a book the reader has not finished, lists only the part they have read.",
			inputSchema: z.object({ book: bookArg }),
			execute: (args) => getOutline(deps, args),
		}),
	};
}

export type ConversationTools = ReturnType<typeof createConversationTools>;
