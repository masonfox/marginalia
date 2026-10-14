export interface LocatorParts {
	shortId: string;
	parserVersion: number;
	spineIndex: number;
	blockIndex: number;
}

/** `<short_id>:v<parser_version>:<spine_index>.<block_index>`, e.g. `3f9a1c07b2de:v1:12.47`. */
export function formatLocator(parts: LocatorParts): string {
	return `${parts.shortId}:v${parts.parserVersion}:${parts.spineIndex}.${parts.blockIndex}`;
}

const LOCATOR = /^([0-9a-f]{12,64}):v(\d{1,6}):(\d{1,6})\.(\d{1,7})$/;

export function parseLocator(locator: string): LocatorParts | null {
	const m = LOCATOR.exec(locator.trim());
	if (!m) return null;
	return {
		shortId: m[1] as string,
		parserVersion: Number(m[2]),
		spineIndex: Number(m[3]),
		blockIndex: Number(m[4]),
	};
}
