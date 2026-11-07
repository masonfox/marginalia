import { createHash } from "node:crypto";
import type { ProgressReading, StoredReading } from "./types";

type Reading = Pick<
	ProgressReading | StoredReading,
	"state" | "locator" | "fraction" | "pages"
>;

/**
 * A hash of what a provider reported (design D5): state, fraction rounded
 * to 4 decimals, pages and locator. `observedAt` is left out, so a reading
 * re-sent with a fresh timestamp is unchanged. Fields go into the hash in a
 * fixed order, so key order in the input never matters.
 */
export function readingFingerprint(reading: Reading): string {
	const { state, fraction, pages, locator } = reading;
	const canonical = [
		state,
		fraction === undefined ? null : Math.round(fraction * 1e4) / 1e4,
		pages ? [pages.current, pages.total] : null,
		locator ? [locator.kind, locator.index, locator.offset ?? null] : null,
	];
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
