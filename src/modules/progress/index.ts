// Reading progress sync: the provider contract, built-in providers, and
// their stored configuration, links and unmatched books.

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
export { readingFingerprint } from "./fingerprint";
export {
	type MappingInput,
	type MappingPassage,
	type MappingUnit,
	mapReading,
} from "./mapping";
export { loadMappingInput } from "./mapping-input";
export { getProvider, listProviders, PROGRESS_PROVIDERS } from "./registry";
export * from "./schema";
export * from "./types";
