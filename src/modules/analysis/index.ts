// Derived per-unit summaries and observations, always read through a position bound.

export { type PreprocessDeps, preprocessEdition } from "./handler";
export { processUnit } from "./process";
export {
	buildUnitPrompt,
	parseUnitOutput,
	UNIT_SYSTEM_PROMPT,
} from "./prompts";
export {
	getBookMap,
	getCurrentUnits,
	getPreprocessStatus,
	hasCurrentPreprocessing,
	lookupObservations,
	MAX_LOOKUP_LIMIT,
	markDerivedStale,
	normalizeNameKey,
	type ObservationView,
	PREPROCESS_PARSER_VERSION,
	PREPROCESS_PROMPT_VERSION,
	type PreprocessState,
	type PreprocessStatus,
	type RunProgress,
	saveUnitResult,
	type UnitResult,
	type UnitSummaryView,
	updateRun,
} from "./queries";
export * from "./schema";
