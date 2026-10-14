// Search, citation resolution, and quote verification. Reads catalog tables; never writes.
import type { Executor } from "#/server/db";
import { type ResolveResult, resolveLocator } from "./resolve";
import { type SearchHit, type SearchInput, searchPassages } from "./search";
import { type VerifyResult, verifyQuote } from "./verify";

export type {
	ResolvedEdition,
	ResolvedPassage,
	ResolveResult,
} from "./resolve";
export {
	type SearchHit,
	type SearchInput,
	type SnippetPart,
	searchInput,
} from "./search";
export {
	getSectionView,
	type SectionPassage,
	type SectionView,
} from "./section";
export { findQuote, type VerifyResult } from "./verify";

/** The retrieval service other server-side modules use; the UI goes through the same functions. */
export interface Retrieval {
	search(input: SearchInput): Promise<SearchHit[]>;
	resolve(
		locator: string,
		options?: { context?: number },
	): Promise<ResolveResult>;
	verifyQuote(locator: string, quote: string): Promise<VerifyResult>;
}

export function createRetrieval(db: Executor): Retrieval {
	return {
		search: (input) => searchPassages(db, input),
		resolve: (locator, options) => resolveLocator(db, locator, options),
		verifyQuote: (locator, quote) => verifyQuote(db, locator, quote),
	};
}
