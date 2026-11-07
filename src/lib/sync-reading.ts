// How the position control words a synced position's raw provider reading.
import type { StoredReading } from "#/modules/progress";

/** The label `moved_back_from` holds when a sync moved back from finished. */
const FINISHED = "Finished";

/**
 * A provider reading in a few words: "finished", "p. 120 of 300", "42%",
 * "section 7" for a spine locator, or "not started". Pages come before a
 * fraction because they are what the reader saw; a fraction is floored, so
 * an unfinished book never reads 100%.
 */
export function readingText(reading: StoredReading): string {
	if (reading.state === "finished") return "finished";
	if (reading.pages && reading.pages.total > 0)
		return `p. ${reading.pages.current} of ${reading.pages.total}`;
	if (reading.fraction !== undefined)
		return `${Math.min(99, Math.floor(reading.fraction * 100 + 1e-9))}%`;
	if (reading.locator) return `section ${reading.locator.index + 1}`;
	if (reading.state === "not-started") return "not started";
	if (reading.state === "abandoned") return "abandoned";
	return "reading";
}

/** "Moved back from Chapter 14", or "Moved back from finished". */
export function movedBackText(label: string): string {
	return `Moved back from ${label === FINISHED ? "finished" : label}`;
}
