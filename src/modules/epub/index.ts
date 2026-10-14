// Pure EPUB parser: bytes → ParsedEdition. No database access.
export { DRM_MESSAGE, EpubError, type EpubErrorCode } from "./errors";
export { formatLocator, type LocatorParts, parseLocator } from "./locator";
export {
	type NormalizedText,
	normalizeText,
	normalizeWithOffsets,
} from "./normalize";
export type { Identifier } from "./package";
export { type ParseOptions, parseEpub, validateEpubContainer } from "./parse";
export * from "./types";
