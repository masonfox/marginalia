// The progress provider contract (design D1, D2). Adapters only fetch and
// parse; mapping a reading to a reading unit belongs to the core.
import type { Edition } from "#/modules/library";

export const PROVIDER_KINDS = ["bookorbit", "hardcover"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Who set a reading position: the reader, or the provider that synced it. */
export type PositionSource = "manual" | ProviderKind;

export const SYNC_SCHEDULES = ["manual", "1h", "6h", "24h"] as const;
export type SyncSchedule = (typeof SYNC_SCHEDULES)[number];

/** `rejected`: the reader unlinked an automatic match (design D5a). */
export const LINK_MATCHED_BY = ["auto", "manual", "rejected"] as const;
export type LinkMatchedBy = (typeof LINK_MATCHED_BY)[number];

/** One field of a provider's generated config form. */
export interface ConfigField {
	key: string;
	label: string;
	/** `secret` fields are stored encrypted and shown masked, hint only. */
	type: "text" | "url" | "secret";
	hint?: string;
	required: boolean;
}

export type ReadingState = "reading" | "finished" | "not-started" | "abandoned";

/** A spine section, and optionally the passage within it. */
export interface SpineLocator {
	kind: "spine";
	index: number;
	offset?: number;
}

/** A provider's raw report of how far the reader is. */
export interface ProgressReading {
	state: ReadingState;
	locator?: SpineLocator;
	/** 0..1 */
	fraction?: number;
	pages?: { current: number; total: number };
	observedAt?: Date;
}

/** A reading as stored in jsonb: the same fields, with `observedAt` as ISO 8601. */
export type StoredReading = Omit<ProgressReading, "observedAt"> & {
	observedAt?: string;
};

export type TestResult =
	| { status: "ok"; detail?: string }
	| { status: "unreachable"; detail?: string }
	| { status: "rejected"; detail?: string }
	| { status: "rate-limited"; detail?: string };

/** A book in a list-mode provider's library, with its reading. */
export interface ProviderBook {
	externalId: string;
	isbns: string[];
	/**
	 * Other ids, keyed by the identifier scheme an EPUB would use for them
	 * (`hardcover-id`, `hardcover-edition`, `hardcover` for the slug,
	 * `goodreads`, ...). Matched against editions by `identifierRows` label.
	 */
	ids: Record<string, string>;
	title: string;
	/** Not in design D2's sketch; `progress_unmatched` stores them for display. */
	authors?: string[];
	reading: ProgressReading;
}

/** One sync fetches every book with its reading; the core matches them. */
export interface ListMatching<C> {
	mode: "list";
	list(cfg: C): Promise<ProviderBook[]>;
}

/** The core asks for one reading per candidate edition, by a provider key. */
export interface LookupMatching<C> {
	mode: "lookup";
	keyFor(edition: Edition): Promise<string | null>;
	get(cfg: C, key: string): Promise<ProgressReading | null>;
}

/** Plain and secret config values together, keyed by `ConfigField.key`. */
export type ProviderConfig = Record<string, string>;

export interface ProgressProvider<C = ProviderConfig> {
	kind: ProviderKind;
	label: string;
	configFields: ConfigField[];
	/** Short setup notes shown with the form. */
	help?: string;
	testConnection(cfg: C): Promise<TestResult>;
	matching: ListMatching<C> | LookupMatching<C>;
}
