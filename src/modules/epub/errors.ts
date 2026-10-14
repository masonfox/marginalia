export type EpubErrorCode =
	| "corrupt"
	| "not_epub"
	| "missing_package"
	| "drm"
	| "too_large"
	| "unsafe_path";

/**
 * A problem with the EPUB file itself. Retrying cannot fix it, so ingestion
 * fails immediately with `message` as the human-readable reason.
 */
export class EpubError extends Error {
	constructor(
		readonly code: EpubErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "EpubError";
	}
}

export const DRM_MESSAGE = "DRM-protected content is not supported";
