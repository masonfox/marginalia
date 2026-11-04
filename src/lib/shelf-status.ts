// The library list's statuses and filters, shared by the shelf query and the
// library page.

/** One status per book: import problems first, otherwise the reading state. */
export const SHELF_STATUSES = [
	"processing",
	"failed",
	"unavailable",
	"not-started",
	"reading",
	"finished",
] as const;
export type ShelfStatus = (typeof SHELF_STATUSES)[number];

/** Statuses that the Needs attention filter matches. */
export const ATTENTION_STATUSES = [
	"processing",
	"failed",
	"unavailable",
] as const satisfies readonly ShelfStatus[];

export const SHELF_FILTERS = [
	"not-started",
	"reading",
	"finished",
	"attention",
] as const;
export type ShelfFilter = (typeof SHELF_FILTERS)[number];

export const MAX_SHELF_QUERY = 200;

export const SHELF_STATUS_LABEL: Record<ShelfStatus, string> = {
	processing: "Processing",
	failed: "Failed",
	unavailable: "Unavailable",
	"not-started": "Not started",
	reading: "Reading",
	finished: "Finished",
};

/**
 * A distinct color per status, from the `--status-*` theme tokens. Written out
 * in full so Tailwind finds every class.
 */
export const SHELF_STATUS_CLASS: Record<ShelfStatus, string> = {
	processing:
		"border-status-processing/30 bg-status-processing/10 text-status-processing",
	failed: "border-status-failed/30 bg-status-failed/10 text-status-failed",
	unavailable:
		"border-status-unavailable/30 bg-status-unavailable/10 text-status-unavailable",
	"not-started":
		"border-status-not-started/30 bg-status-not-started/10 text-status-not-started",
	reading: "border-status-reading/30 bg-status-reading/10 text-status-reading",
	finished:
		"border-status-finished/30 bg-status-finished/10 text-status-finished",
};

const FILTER_LABEL: Record<ShelfFilter, string> = {
	"not-started": "Not started",
	reading: "Reading",
	finished: "Finished",
	attention: "Needs attention",
};

export interface ShelfFilterOption {
	value: ShelfFilter | undefined;
	label: string;
}

/** Needs attention is offered only while some book needs it, or while it is selected. */
export function shelfFilterOptions(
	needsAttention: number,
	selected: ShelfFilter | undefined,
): ShelfFilterOption[] {
	const options: ShelfFilterOption[] = [{ value: undefined, label: "All" }];
	for (const value of SHELF_FILTERS) {
		if (value === "attention" && needsAttention === 0 && selected !== value)
			continue;
		options.push({ value, label: FILTER_LABEL[value] });
	}
	return options;
}

const books = (n: number) => (n === 1 ? "1 book" : `${n} books`);

/** "N books", or "M of N books" while a search or filter is active. */
export function shelfCountLabel(
	total: number,
	matching: number,
	narrowed: boolean,
): string {
	return narrowed ? `${matching} of ${books(total)}` : books(total);
}
