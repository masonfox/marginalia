// ISBN normalization for matching provider books to editions: every valid
// ISBN, in any common written form, becomes one ISBN-13 string.

const PREFIX = /^(?:urn:)?isbn(?:-1[03])?[:\s]\s*/i;

function isbn13Check(first12: string): string {
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
	return String((10 - (sum % 10)) % 10);
}

function isbn10Valid(isbn: string): boolean {
	let sum = 0;
	for (let i = 0; i < 10; i++) {
		const c = isbn[i];
		const d = c === "X" ? 10 : Number(c);
		sum += d * (10 - i);
	}
	return sum % 11 === 0;
}

/**
 * The ISBN-13 form of an ISBN-10 or ISBN-13, written with or without hyphens,
 * spaces or an `isbn:` / `urn:isbn:` prefix. Null when the text is not a valid
 * ISBN (wrong length, bad characters, or a failed check digit).
 */
export function normalizeIsbn(raw: string): string | null {
	const text = raw.trim().replace(PREFIX, "");
	const compact = text.replace(/[-\s]/g, "").toUpperCase();
	if (/^\d{9}[\dX]$/.test(compact)) {
		if (!isbn10Valid(compact)) return null;
		const first12 = `978${compact.slice(0, 9)}`;
		return first12 + isbn13Check(first12);
	}
	if (/^97[89]\d{10}$/.test(compact)) {
		return isbn13Check(compact.slice(0, 12)) === compact[12] ? compact : null;
	}
	return null;
}
