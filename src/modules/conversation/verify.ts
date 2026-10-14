import { parseCitationMarkers } from "#/lib/citations";
import type { Retrieval } from "#/modules/retrieval";
import type { ConversationBook } from "./repository";
import type { CitationRecord } from "./schema";

export interface VerifyDeps {
	retrieval: Retrieval;
	books: ConversationBook[];
}

/**
 * Verifies every citation marker in `text` against the books. The verdict is
 * computed here, never taken from the model. Identical (locator, quote) pairs
 * produce one record.
 */
export async function verifyCitations(
	deps: VerifyDeps,
	text: string,
): Promise<CitationRecord[]> {
	const seen = new Set<string>();
	const records: CitationRecord[] = [];
	for (const m of parseCitationMarkers(text)) {
		const key = `${m.locator}\u0000${m.quote}`;
		if (seen.has(key)) continue;
		seen.add(key);
		records.push(await verifyOne(deps, m.locator, m.quote));
	}
	return records;
}

async function verifyOne(
	{ retrieval, books }: VerifyDeps,
	locator: string,
	quote: string,
): Promise<CitationRecord> {
	const base = { locator, quote };
	const resolved = await retrieval.resolve(locator);
	if (resolved.status === "not_found") {
		return {
			...base,
			editionId: null,
			currentLocator: null,
			status: "not_found",
		};
	}
	const editionId = resolved.edition.id;
	if (!books.some((b) => b.editionId === editionId)) {
		return {
			...base,
			editionId,
			currentLocator: null,
			status: "not_in_conversation",
		};
	}
	if (resolved.status === "removed") {
		return { ...base, editionId, currentLocator: null, status: "removed" };
	}
	const display = {
		bookTitle: resolved.edition.title,
		sectionTitle: resolved.section.title,
	};
	const verdict = await retrieval.verifyQuote(locator, quote);
	switch (verdict.status) {
		case "verified":
			return {
				...base,
				editionId,
				currentLocator: verdict.currentLocator,
				status: "verified",
				...display,
				range: verdict.range,
			};
		case "mismatch":
			return {
				...base,
				editionId,
				currentLocator: verdict.currentLocator,
				status: "quote_mismatch",
				...display,
			};
		case "removed":
			return { ...base, editionId, currentLocator: null, status: "removed" };
		case "not_found":
			return {
				...base,
				editionId,
				currentLocator: null,
				status: "not_found",
			};
	}
}
