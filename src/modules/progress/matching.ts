// Linking editions to provider books (spec "Matching books to provider
// books"). Automatic links need an unambiguous match; manual links always
// win and are never replaced by automatic matching, and an unlinked
// automatic match stays rejected (design D5a).
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { identifierRows } from "#/lib/edition-facts";
import { editions } from "#/modules/library";
import type { Database, Executor } from "#/server/db";
import { toStoredReading } from "./apply";
import { normalizeIsbn } from "./isbn";
import { progressLinks, progressUnmatched } from "./schema";
import type { LinkMatchedBy, ProviderBook, ProviderKind } from "./types";

/** A provider book and the edition it is linked to after a list-mode match. */
export interface LinkedBook {
	editionId: string;
	book: ProviderBook;
	matchedBy: Exclude<LinkMatchedBy, "rejected">;
}

/** Labels (from `identifierRows`) too generic to identify a book. */
const UNMATCHABLE = new Set(["ISBN", "Identifier", "UUID", "Calibre", "Web"]);

type Ids = { scheme: string | null; value: string }[];

/** Normalized ISBN-13s in a list of identifiers, including scheme-less values. */
function isbnsOf(identifiers: Ids): string[] {
	const out = new Set<string>();
	for (const row of identifierRows(identifiers)) {
		if (row.label !== "ISBN" && row.label !== "Identifier") continue;
		const isbn = normalizeIsbn(row.value);
		if (isbn) out.add(isbn);
	}
	return [...out];
}

/** Comparable keys for non-ISBN ids, such as "Hardcover ID:12345". */
function idKeysOf(identifiers: Ids): string[] {
	const out = new Set<string>();
	for (const row of identifierRows(identifiers)) {
		if (UNMATCHABLE.has(row.label)) continue;
		out.add(`${row.label}:${row.value.toLowerCase()}`);
	}
	return [...out];
}

function addTo(index: Map<string, Set<string>>, key: string, id: string) {
	let set = index.get(key);
	if (!set) {
		set = new Set();
		index.set(key, set);
	}
	set.add(id);
}

interface EditionIndex {
	isbn: Map<string, Set<string>>;
	ids: Map<string, Set<string>>;
}

async function loadEditionIndex(db: Executor): Promise<EditionIndex> {
	const rows = await db
		.select({ id: editions.id, identifiers: editions.identifiers })
		.from(editions);
	const index: EditionIndex = { isbn: new Map(), ids: new Map() };
	for (const row of rows) {
		for (const isbn of isbnsOf(row.identifiers))
			addTo(index.isbn, isbn, row.id);
		for (const key of idKeysOf(row.identifiers)) addTo(index.ids, key, row.id);
	}
	return index;
}

function lookup(index: Map<string, Set<string>>, keys: string[]): Set<string> {
	const out = new Set<string>();
	for (const key of keys) for (const id of index.get(key) ?? []) out.add(id);
	return out;
}

/**
 * Editions a provider book matches. ISBNs name a specific edition, so they
 * are tried first; provider ids (often work-level, such as a Hardcover book
 * id) are tried only when no ISBN matched. Editions in `taken` (manually
 * linked, or holding a rejected link) are left out.
 */
function candidatesFor(
	book: ProviderBook,
	index: EditionIndex,
	taken: Set<string>,
): string[] {
	const isbns = book.isbns.flatMap((raw) => normalizeIsbn(raw) ?? []);
	const ids = idKeysOf(
		Object.entries(book.ids).map(([scheme, value]) => ({ scheme, value })),
	);
	for (const found of [lookup(index.isbn, isbns), lookup(index.ids, ids)]) {
		const free = [...found].filter((id) => !taken.has(id));
		if (free.length > 0) return free;
	}
	return [];
}

/**
 * Matches a list-mode provider's books against the library. Keeps manual
 * links, links unambiguous matches automatically, drops automatic links that
 * no longer match, and replaces the provider's unmatched list with the books
 * being read that have no edition (no match, more than one, or a rejected
 * link). A rejected link blocks automatic linking of both its edition and
 * its book, since the row holds both for this provider. Returns every
 * linked book for the caller to apply; readings are not applied here.
 */
export async function matchProviderBooks(
	db: Database,
	kind: ProviderKind,
	books: ProviderBook[],
): Promise<LinkedBook[]> {
	const byId = new Map(books.map((b) => [b.externalId, b]));
	return db.transaction(async (tx) => {
		const [index, links] = await Promise.all([
			loadEditionIndex(tx),
			tx
				.select()
				.from(progressLinks)
				.where(eq(progressLinks.providerKind, kind)),
		]);
		const linkByExternal = new Map(links.map((l) => [l.externalId, l]));
		const linkByEdition = new Map(links.map((l) => [l.editionId, l]));
		const takenEditions = new Set(
			links.filter((l) => l.matchedBy !== "auto").map((l) => l.editionId),
		);

		const linked: LinkedBook[] = [];
		const unmatched: ProviderBook[] = [];
		const proposed = new Map<string, ProviderBook[]>();
		for (const book of byId.values()) {
			const existing = linkByExternal.get(book.externalId);
			if (existing?.matchedBy === "manual") {
				linked.push({
					editionId: existing.editionId,
					book,
					matchedBy: "manual",
				});
				continue;
			}
			if (existing?.matchedBy === "rejected") {
				unmatched.push(book);
				continue;
			}
			const found = candidatesFor(book, index, takenEditions);
			const [only] = found;
			if (found.length === 1 && only) {
				proposed.set(only, [...(proposed.get(only) ?? []), book]);
			} else {
				unmatched.push(book);
			}
		}

		// Auto links to write: one book per edition; a contested edition is ambiguous.
		const wanted = new Map<string, string>(); // externalId → editionId
		for (const [editionId, claimants] of proposed) {
			const [only] = claimants;
			if (claimants.length === 1 && only) {
				wanted.set(only.externalId, editionId);
				linked.push({ editionId, book: only, matchedBy: "auto" });
			} else {
				unmatched.push(...claimants);
			}
		}

		// Stale auto links: books in this list that now match elsewhere or
		// nowhere, and editions about to hold a different book.
		const stale = new Set<string>();
		for (const link of links) {
			if (link.matchedBy !== "auto") continue;
			const book = byId.get(link.externalId);
			if (book && wanted.get(book.externalId) !== link.editionId) {
				stale.add(link.externalId);
			}
		}
		const inserts: (typeof progressLinks.$inferInsert)[] = [];
		for (const [externalId, editionId] of wanted) {
			const current = linkByEdition.get(editionId);
			if (current?.externalId === externalId) continue;
			if (current) stale.add(current.externalId);
			inserts.push({
				editionId,
				providerKind: kind,
				externalId,
				matchedBy: "auto",
			});
		}
		if (stale.size > 0) {
			await tx
				.delete(progressLinks)
				.where(
					and(
						eq(progressLinks.providerKind, kind),
						eq(progressLinks.matchedBy, "auto"),
						inArray(progressLinks.externalId, [...stale]),
					),
				);
		}
		if (inserts.length > 0) await tx.insert(progressLinks).values(inserts);

		await tx
			.delete(progressUnmatched)
			.where(eq(progressUnmatched.providerKind, kind));
		const listed = unmatched.filter((b) => b.reading.state === "reading");
		if (listed.length > 0) {
			await tx.insert(progressUnmatched).values(
				listed.map((b) => ({
					providerKind: kind,
					externalId: b.externalId,
					title: b.title,
					authors: b.authors ?? [],
					isbns: b.isbns,
					reading: toStoredReading(b.reading),
				})),
			);
		}
		return linked;
	});
}

/**
 * Links an edition to a lookup-mode provider's book by key (such as a
 * KOReader digest) unless a manual or rejected link of that edition or that
 * key says otherwise. Returns whether the edition ends up linked to
 * `externalId`.
 */
export async function linkByKey(
	db: Database,
	editionId: string,
	kind: ProviderKind,
	externalId: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const links = await tx
			.select()
			.from(progressLinks)
			.where(
				and(
					eq(progressLinks.providerKind, kind),
					or(
						eq(progressLinks.editionId, editionId),
						eq(progressLinks.externalId, externalId),
					),
				),
			);
		const mine = links.find((l) => l.editionId === editionId);
		if (mine?.externalId === externalId) return mine.matchedBy !== "rejected";
		if (links.some((l) => l.matchedBy !== "auto")) return false;
		if (links.length > 0) {
			await tx.delete(progressLinks).where(
				and(
					eq(progressLinks.providerKind, kind),
					inArray(
						progressLinks.externalId,
						links.map((l) => l.externalId),
					),
				),
			);
		}
		await tx
			.insert(progressLinks)
			.values({ editionId, providerKind: kind, externalId, matchedBy: "auto" });
		return true;
	});
}

/**
 * Links a provider book to an edition by hand, replacing any other link of
 * that edition or that book for this provider (rejected ones included), and
 * removes the book from the
 * unmatched list.
 */
export async function manualLink(
	db: Database,
	kind: ProviderKind,
	externalId: string,
	editionId: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.delete(progressLinks)
			.where(
				and(
					eq(progressLinks.providerKind, kind),
					or(
						and(
							eq(progressLinks.externalId, externalId),
							ne(progressLinks.editionId, editionId),
						),
						and(
							eq(progressLinks.editionId, editionId),
							ne(progressLinks.externalId, externalId),
						),
					),
				),
			);
		await tx
			.insert(progressLinks)
			.values({
				editionId,
				providerKind: kind,
				externalId,
				matchedBy: "manual",
			})
			.onConflictDoUpdate({
				target: [progressLinks.editionId, progressLinks.providerKind],
				set: { matchedBy: "manual" },
			});
		await tx
			.delete(progressUnmatched)
			.where(
				and(
					eq(progressUnmatched.providerKind, kind),
					eq(progressUnmatched.externalId, externalId),
				),
			);
	});
}

/**
 * Unlinks an edition from a provider (design D5a). An automatic link becomes
 * `rejected`, keeping its book id so sync never links the pair again; a
 * manual link is deleted. Returns whether a live link existed.
 */
export async function unlink(
	db: Executor,
	editionId: string,
	kind: ProviderKind,
): Promise<boolean> {
	const where = and(
		eq(progressLinks.editionId, editionId),
		eq(progressLinks.providerKind, kind),
	);
	const rejected = await db
		.update(progressLinks)
		.set({ matchedBy: "rejected" })
		.where(and(where, eq(progressLinks.matchedBy, "auto")))
		.returning({ editionId: progressLinks.editionId });
	if (rejected.length > 0) return true;
	const removed = await db
		.delete(progressLinks)
		.where(and(where, eq(progressLinks.matchedBy, "manual")))
		.returning({ editionId: progressLinks.editionId });
	return removed.length > 0;
}
