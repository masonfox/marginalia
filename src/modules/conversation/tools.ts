import { tool } from "ai";
import { z } from "zod";
import {
	getBookMap,
	hasCurrentPreprocessing,
	lookupObservations as queryObservations,
} from "#/modules/analysis";
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
	observations: 20,
	observationChars: 1000,
	observationCitations: 5,
	/**
	 * readSection's budget per call. 16k chars is ~4k tokens: a typical
	 * 3-5k-word chapter (~18-30k chars) reads in two calls, a long one in
	 * three. Every tool result is re-sent on each later step, so three reads
	 * add ~12k input tokens per step — far cheaper than paging with
	 * readPassage, which spends a whole step per ~11 passages.
	 */
	sectionChars: 16000,
	/** Rows fetched per readSection call; enough that the char budget, not this, usually binds. */
	sectionPassages: 300,
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
 * Reads forward through a section from `locator`, packing consecutive
 * passages up to `LIMITS.sectionChars`. Stops at the budget, the section's
 * end, or the book's reading-scope bound; `next` resumes where it stopped.
 */
export async function readSection(deps: ToolDeps, args: { locator: string }) {
	const result = await deps.retrieval.readForward(args.locator, {
		limit: LIMITS.sectionPassages,
	});
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

	const kept: ReturnType<typeof shape>[] = [];
	let size = 0;
	let next: string | null = null;
	let reachedScope = false;
	for (const p of [result.passage, ...result.following]) {
		if (!visible(p)) {
			reachedScope = true;
			break;
		}
		const item = shape(p);
		const length = JSON.stringify(item).length;
		if (kept.length > 0 && size + length > LIMITS.sectionChars) {
			next = p.locator;
			break;
		}
		kept.push(item);
		size += length;
	}
	if (!reachedScope && next === null && result.continuation) {
		if (visible(result.continuation)) next = result.continuation.locator;
		else reachedScope = true;
	}
	const endOfSection = !reachedScope && next === null;
	let nextSection: string | null = null;
	if (endOfSection && result.nextSection) {
		if (visible(result.nextSection)) nextSection = result.nextSection.locator;
		else reachedScope = true;
	}
	return {
		status: "ok" as const,
		superseded: result.superseded,
		book: bookHandle(book),
		bookTitle: result.edition.title,
		section: result.section.title,
		path: result.tocPath,
		passages: kept,
		truncated: next !== null,
		next,
		endOfSection,
		...(endOfSection && { nextSection }),
		...(reachedScope && { continuesBeyondScope: true }),
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

export async function lookupObservations(
	deps: ToolDeps,
	args: { book: string; name: string; limit?: number },
) {
	const selected = selectBooks(deps, args.book);
	if (selected.error) return selected.error;
	const book = selected.books[0];
	if (!book) return { status: "unknown_book" as const };
	if (!(await hasCurrentPreprocessing(deps.db, book.editionId))) {
		return {
			status: "unavailable" as const,
			message:
				"Observations are unavailable: this book has no current preprocessing. Search the text instead.",
		};
	}
	const limit = Math.max(
		1,
		Math.min(args.limit ?? LIMITS.observations, LIMITS.observations),
	);
	const [observations, map] = await Promise.all([
		queryObservations(
			deps.db,
			book.editionId,
			args.name,
			book.maxPosition,
			limit + 1,
		),
		getBookMap(deps.db, book.editionId, book.maxPosition),
	]);
	const labels = new Map(map.map((s) => [s.unitOrdinal, s.unitLabel]));
	const results = observations.slice(0, limit).map((o) => ({
		unitLabel: clip(
			labels.get(o.unitOrdinal) ?? `Unit ${o.unitOrdinal + 1}`,
			LIMITS.observationChars,
		),
		name: clip(o.name, LIMITS.observationChars),
		kind: o.kind,
		note: clip(o.note, LIMITS.observationChars),
		// Keep exact citation text and its verification state together; drop oversized citations.
		citations: o.citations
			.filter(
				(c) =>
					c.locator.length <= 200 && c.quote.length <= LIMITS.observationChars,
			)
			.slice(0, LIMITS.observationCitations),
	}));
	if (observations.length === 0)
		return {
			status: "not_found" as const,
			message:
				"No observations found within the reading scope. Search the text instead.",
		};
	const capped = capItems(results);
	return {
		status: "ok" as const,
		book: bookHandle(book),
		message:
			"Derived observations are a guide, not evidence, and may be incomplete or wrong. Read the cited passages before making claims; unverified citations need checking.",
		count: capped.items.length,
		truncated:
			capped.truncated ||
			observations.length > limit ||
			observations.some(
				(o) =>
					o.citations.length > LIMITS.observationCitations ||
					o.note.length > LIMITS.observationChars ||
					o.name.length > LIMITS.observationChars ||
					o.citations.some(
						(c) =>
							c.quote.length > LIMITS.observationChars ||
							c.locator.length > 200,
					),
			),
		results: capped.items,
	};
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
		readSection: tool({
			description:
				"Read through a scene or chapter: consecutive passages of one section, starting at any locator (such as a section start from getOutline), up to a large size budget, each with its own citable locator. When truncated, call again with `next` to continue exactly where it stopped. At the section's end, `nextSection` gives the next section's start. Use this to read a stretch of text; use readPassage to check a single passage before quoting it.",
			inputSchema: z.object({ locator: z.string().min(1).max(200) }),
			execute: (args) => readSection(deps, args),
		}),
		getOutline: tool({
			description:
				"The table of contents of a book (section titles with the locator of their first passage), for navigating its structure. For a book the reader has not finished, lists only the part they have read.",
			inputSchema: z.object({ book: bookArg }),
			execute: (args) => getOutline(deps, args),
		}),
		lookupObservations: tool({
			description:
				"Look up derived observations about a character, place, object, or motif by name in one conversation book, within its reading scope. These are guidance, not citable evidence: read supporting passages before making claims.",
			inputSchema: z.object({
				book: z.string().min(1).max(20).describe("Book handle such as b1."),
				name: z.string().trim().min(1).max(300),
				limit: z.number().int().min(1).max(LIMITS.observations).optional(),
			}),
			execute: (args) => lookupObservations(deps, args),
		}),
	};
}

export type ConversationTools = ReturnType<typeof createConversationTools>;
