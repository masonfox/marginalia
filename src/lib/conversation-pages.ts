/**
 * The rows of every loaded page, each id once, in page order. The keyset
 * cursor already keeps a page from repeating an earlier one; this also
 * covers a refetch of earlier pages racing a later one.
 */
export function uniqueById<T extends { id: string }>(
	pages: { items: T[] }[],
): T[] {
	const seen = new Set<string>();
	const rows: T[] = [];
	for (const page of pages)
		for (const item of page.items) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			rows.push(item);
		}
	return rows;
}
