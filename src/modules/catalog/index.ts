// Persists parsed editions: sections, table of contents, passages, and notes.
export { countPassages, getToc, type TocNode } from "./browse";
export {
	type IngestDeps,
	type IngestOutcome,
	ingestEdition,
	reparseEdition,
} from "./ingest";
export {
	type LocatorMatch,
	matchLocators,
	OVERLAP_THRESHOLD,
} from "./matching";
export {
	type EditionKey,
	type ReplaceOptions,
	replaceEditionStructure,
} from "./persist";
export * from "./schema";
export { FALLBACK_SEARCH_CONFIG, resolveSearchConfig } from "./search-config";
