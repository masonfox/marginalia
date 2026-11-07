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
export * from "./schema";
export * from "./types";
