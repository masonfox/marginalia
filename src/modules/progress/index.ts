// Reading progress sync: the provider contract, built-in providers, and
// their stored configuration, links and unmatched books.

export { type ApplyResult, applyReading, toStoredReading } from "./apply";
export {
	getProviderConfig,
	type LoadedProviderConfig,
	listProviderConfigs,
	loadProviderConfig,
	type ProviderConfigInput,
	type ProviderConfigSaveResult,
	type ProviderConfigView,
	type SecretFieldStatus,
	saveProviderConfig,
} from "./config-store";
export {
	ProviderError,
	type ProviderErrorReason,
	RateLimitedError,
} from "./errors";
export { setSyncExcluded } from "./exclude";
export { readingFingerprint } from "./fingerprint";
export { normalizeIsbn } from "./isbn";
export {
	type MappingInput,
	type MappingPassage,
	type MappingUnit,
	mapReading,
} from "./mapping";
export { loadMappingInput } from "./mapping-input";
export {
	type LinkedBook,
	linkByKey,
	manualLink,
	matchProviderBooks,
	unlink,
} from "./matching";
export { getProvider, listProviders, PROGRESS_PROVIDERS } from "./registry";
export {
	applySyncSchedule,
	reconcileSyncSchedules,
	SYNC_CRON,
	saveProviderSettings,
	syncCron,
} from "./schedule";
export * from "./schema";
export {
	clearPositionByHand,
	getSyncStatus,
	type SyncStatus,
} from "./status";
export {
	type BookProviderResult,
	type BookSyncResult,
	enqueueBookSync,
	enqueueProviderSync,
	isProviderKind,
	LOOKUP_RECENT_DAYS,
	lookupCandidates,
	type ProviderSyncResult,
	runBookSyncJob,
	runProviderSyncJob,
	type SyncDeps,
	syncBook,
	syncFailureMessage,
	syncProvider,
} from "./sync";
export * from "./types";
