/**
 * Turns an edition's raw EPUB metadata into what the About tab shows: a
 * language name instead of a code, a publication date no more precise than
 * the metadata really is, and identifiers sorted into labelled, deduplicated
 * rows. Formatting uses a fixed English locale and UTC so the server and the
 * browser render the same text.
 */

const LOCALE = "en";

/** "eng" → "English", "en-GB" → "British English"; the raw code when unknown. */
export function languageName(code: string | null): string | null {
	const trimmed = code?.trim();
	if (!trimmed) return null;
	try {
		const names = new Intl.DisplayNames([LOCALE], {
			type: "language",
			fallback: "none",
		});
		return names.of(trimmed.replace(/_/g, "-")) ?? trimmed;
	} catch {
		return trimmed;
	}
}

export interface PublishedDate {
	/** What to show: "1985", "March 2007", "March 20, 2007", or the raw text. */
	label: string;
	/** A valid `<time datetime>` value, or null when the text is not a date. */
	dateTime: string | null;
}

const DATE =
	/^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/;

/**
 * Formats an OPF `dc:date`. Many tools store a year as January 1st (often at
 * midnight), so a date on January 1st with no time of day past midnight shows
 * just the year rather than a precise day nobody recorded.
 */
export function formatPublished(raw: string | null): PublishedDate | null {
	const text = raw?.trim();
	if (!text) return null;
	const m = DATE.exec(text);
	if (!m) return { label: text, dateTime: null };
	const [, year, month, day, hh, mm, ss] = m;
	const y = Number(year);
	const mo = month ? Number(month) : null;
	const d = day ? Number(day) : null;
	if ((mo !== null && (mo < 1 || mo > 12)) || (d !== null && (d < 1 || d > 31)))
		return { label: text, dateTime: null };
	const midnight = (!hh || hh === "00") && (!mm || mm === "00") && !Number(ss);
	if (mo === null || (mo === 1 && d === 1 && midnight)) {
		return { label: String(y), dateTime: year ?? String(y) };
	}
	const utc = new Date(Date.UTC(y, mo - 1, d ?? 1));
	if (d === null) {
		return {
			label: utc.toLocaleDateString(LOCALE, {
				year: "numeric",
				month: "long",
				timeZone: "UTC",
			}),
			dateTime: `${year}-${month}`,
		};
	}
	return {
		label: utc.toLocaleDateString(LOCALE, {
			year: "numeric",
			month: "long",
			day: "numeric",
			timeZone: "UTC",
		}),
		dateTime: `${year}-${month}-${day}`,
	};
}

/** 12345 → "12,345". */
export function formatCount(n: number): string {
	return new Intl.NumberFormat(LOCALE).format(n);
}

export interface IdentifierRow {
	/** Stable key for React lists. */
	key: string;
	/** "ISBN", "Goodreads", "Hardcover", ... */
	label: string;
	value: string;
	/** A page for exactly this identifier, when there is one beyond doubt. */
	href: string | null;
	/** Bookkeeping ids (UUIDs, Calibre ids, numeric edition ids): shown tucked away. */
	internal: boolean;
}

interface Scheme {
	label: string;
	internal?: boolean;
	href?: (value: string) => string | null;
	/** Comparison form, for spotting the same id written twice. */
	normalize?: (value: string) => string;
}

const isbnDigits = (v: string) => v.replace(/[-\s]/g, "").toUpperCase();

const SCHEMES: Record<string, Scheme> = {
	ISBN: {
		label: "ISBN",
		normalize: isbnDigits,
		href: (v) =>
			/^(\d{9}[\dX]|97[89]\d{10})$/.test(isbnDigits(v))
				? `https://openlibrary.org/isbn/${isbnDigits(v)}`
				: null,
	},
	GOODREADS: {
		label: "Goodreads",
		href: (v) =>
			/^\d+$/.test(v) ? `https://www.goodreads.com/book/show/${v}` : null,
	},
	HARDCOVER: {
		label: "Hardcover",
		href: (v) =>
			/^[a-z0-9-]+$/i.test(v) ? `https://hardcover.app/books/${v}` : null,
	},
	HARDCOVER_SLUG: {
		label: "Hardcover",
		href: (v) =>
			/^[a-z0-9-]+$/i.test(v) ? `https://hardcover.app/books/${v}` : null,
	},
	HARDCOVER_ID: { label: "Hardcover ID", internal: true },
	HARDCOVER_EDITION: { label: "Hardcover edition", internal: true },
	GOOGLE: {
		label: "Google Books",
		href: (v) =>
			/^[\w-]+$/.test(v)
				? `https://books.google.com/books?id=${encodeURIComponent(v)}`
				: null,
	},
	DOI: {
		label: "DOI",
		href: (v) => (v.startsWith("10.") ? `https://doi.org/${v}` : null),
	},
	// Which Amazon store an ASIN belongs to is unknown, so no link.
	AMAZON: { label: "ASIN" },
	ASIN: { label: "ASIN" },
	MOBI_ASIN: { label: "ASIN" },
	CALIBRE: { label: "Calibre", internal: true },
	UUID: {
		label: "UUID",
		internal: true,
		normalize: (v) => v.toLowerCase(),
	},
	URL: { label: "Web", href: (v) => v },
};

/** Schemes written into the value, as in "isbn:978…" or "urn:uuid:…". */
const PREFIX = /^(?:urn:)?([a-z][a-z0-9_-]*):(?!\/\/)(.+)$/i;
const WEB = /^https?:\/\/\S+$/i;
const UUID_VALUE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function schemeKey(scheme: string) {
	return scheme.toUpperCase().replace(/-/g, "_");
}

/** "lccn" → "LCCN"; "open_library" → "Open Library". */
function schemeLabel(scheme: string) {
	if (/^[a-z]{2,4}$/i.test(scheme)) return scheme.toUpperCase();
	return scheme
		.toLowerCase()
		.split(/[_-]+/)
		.filter(Boolean)
		.map((w) => w[0]?.toUpperCase() + w.slice(1))
		.join(" ");
}

/**
 * Labelled, deduplicated identifier rows: public ids (ISBN, Goodreads, ...)
 * first in a stable order, bookkeeping ids flagged `internal`.
 */
export function identifierRows(
	identifiers: { scheme: string | null; value: string }[],
): IdentifierRow[] {
	const seen = new Set<string>();
	const rows: IdentifierRow[] = [];
	for (const id of identifiers) {
		let scheme = id.scheme?.trim() || null;
		let value = id.value.trim();
		if (!value) continue;
		if (!scheme) {
			const m = WEB.test(value) ? null : PREFIX.exec(value);
			if (m?.[1] && m[2]) {
				scheme = m[1];
				value = m[2].trim();
			} else if (WEB.test(value)) {
				scheme = "URL";
			} else if (UUID_VALUE.test(value)) {
				scheme = "UUID";
			}
		}
		const key = scheme ? schemeKey(scheme) : "";
		const known = SCHEMES[key];
		const label = known?.label ?? (scheme ? schemeLabel(scheme) : "Identifier");
		const dedupe = `${label}:${known?.normalize?.(value) ?? value}`;
		if (seen.has(dedupe)) continue;
		seen.add(dedupe);
		rows.push({
			key: dedupe,
			label,
			value,
			href: known?.href?.(value) ?? null,
			internal: known?.internal ?? false,
		});
	}
	const order = Object.values(SCHEMES).map((s) => s.label);
	const rank = (r: IdentifierRow) => {
		const i = order.indexOf(r.label);
		return i === -1 ? order.length : i;
	};
	// Array.prototype.sort is stable, so equal ranks keep the book's order.
	return rows.sort((a, b) => rank(a) - rank(b));
}
