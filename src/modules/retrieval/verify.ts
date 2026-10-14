import { normalizeWithOffsets } from "#/modules/epub";
import type { Executor } from "#/server/db";
import { type ResolveResult, resolveLocator } from "./resolve";

export type VerifyResult =
	| {
			status: "verified";
			superseded: boolean;
			currentLocator: string;
			/** Character range of the match in the passage's original text. */
			range: { start: number; end: number };
			matchedText: string;
	  }
	| { status: "mismatch"; superseded: boolean; currentLocator: string }
	| { status: "removed" | "not_found"; requestedLocator: string };

/**
 * Checks that `quote` appears in the passage at `locator` (forwarding older
 * locators first), ignoring whitespace, case, and typographic quote and dash
 * variants.
 */
export async function verifyQuote(
	db: Executor,
	locator: string,
	quote: string,
): Promise<VerifyResult> {
	const resolved = await resolveLocator(db, locator);
	if (resolved.status !== "found") {
		return {
			status: resolved.status,
			requestedLocator: resolved.requestedLocator,
		};
	}
	return verifyAgainst(resolved, quote);
}

export function verifyAgainst(
	resolved: Extract<ResolveResult, { status: "found" }>,
	quote: string,
): VerifyResult {
	const base = {
		superseded: resolved.superseded,
		currentLocator: resolved.currentLocator,
	};
	const range = findQuote(resolved.passage.text, quote);
	if (!range) return { status: "mismatch", ...base };
	return {
		status: "verified",
		...base,
		range,
		matchedText: resolved.passage.text.slice(range.start, range.end),
	};
}

/** Finds `quote` in `text` after normalizing both; returns the range in `text`'s coordinates. */
export function findQuote(
	text: string,
	quote: string,
): { start: number; end: number } | null {
	const needle = normalizeWithOffsets(quote).text;
	if (!needle) return null;
	const hay = normalizeWithOffsets(text);
	const at = hay.text.indexOf(needle);
	if (at < 0) return null;
	const start = hay.offsets[at] as number;
	let end = hay.offsets[at + needle.length] as number;
	while (end > start && /\s/.test(text[end - 1] as string)) end--;
	return { start, end };
}
