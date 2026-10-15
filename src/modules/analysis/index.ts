// Derived per-unit summaries and observations, always read through a position bound.

export { type PreprocessDeps, preprocessEdition } from "./handler";
export { processUnit } from "./process";
export {
	buildUnitPrompt,
	parseUnitOutput,
	UNIT_SYSTEM_PROMPT,
} from "./prompts";
export {
	cancelRun,
	claimRun,
	getBookMap,
	getCurrentUnits,
	getPreprocessStatus,
	hasCurrentPreprocessing,
	INTERRUPTED_RUN_ERROR,
	listObservations,
	listObservedNames,
	listSummaries,
	lookupObservations,
	MAX_LOOKUP_LIMIT,
	markDerivedStale,
	normalizeNameKey,
	type ObservationRow,
	type ObservationView,
	type ObservedName,
	PREPROCESS_PARSER_VERSION,
	PREPROCESS_PROMPT_VERSION,
	type PreprocessState,
	type PreprocessStatus,
	type QueuedJobState,
	type RunProgress,
	StructureChangedError,
	type SummaryRow,
	saveUnitResult,
	type UnitResult,
	type UnitSummaryView,
	updateRun,
} from "./queries";
export * from "./schema";
