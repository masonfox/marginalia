import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { editions } from "#/modules/library";

/** A quote cited from a passage of the unit; `verified` is false when it could not be confirmed. */
export interface DerivedCitation {
	locator: string;
	quote: string;
	verified: boolean;
}

export const OBSERVATION_KINDS = [
	"character",
	"place",
	"object",
	"motif",
] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** One current summary per reading unit. Derived data: a guide, not evidence. */
export const unitSummaries = pgTable(
	"unit_summaries",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		unitOrdinal: integer("unit_ordinal").notNull(),
		unitLabel: text("unit_label").notNull(),
		/** The unit's last reading-order position; the bound compares against it. */
		endPosition: integer("end_position").notNull(),
		summary: text("summary").notNull(),
		citations: jsonb("citations")
			.$type<DerivedCitation[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		model: text("model").notNull(),
		promptVersion: integer("prompt_version").notNull(),
		parserVersion: integer("parser_version").notNull(),
		stale: boolean("stale").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		unique("unit_summaries_edition_unit_uq").on(t.editionId, t.unitOrdinal),
		index("unit_summaries_bound_idx").on(t.editionId, t.endPosition),
	],
);

export const unitObservations = pgTable(
	"unit_observations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		unitOrdinal: integer("unit_ordinal").notNull(),
		endPosition: integer("end_position").notNull(),
		name: text("name").notNull(),
		/** Normalized `name` for lookup. */
		nameKey: text("name_key").notNull(),
		kind: text("kind", { enum: OBSERVATION_KINDS }).notNull(),
		note: text("note").notNull(),
		citations: jsonb("citations")
			.$type<DerivedCitation[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		model: text("model").notNull(),
		promptVersion: integer("prompt_version").notNull(),
		parserVersion: integer("parser_version").notNull(),
		stale: boolean("stale").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("unit_observations_lookup_idx").on(
			t.editionId,
			t.nameKey,
			t.endPosition,
		),
		index("unit_observations_unit_idx").on(t.editionId, t.unitOrdinal),
	],
);

/** One row per edition, reused across runs. */
export const preprocessRuns = pgTable(
	"preprocess_runs",
	{
		editionId: uuid("edition_id")
			.primaryKey()
			.references(() => editions.id, { onDelete: "cascade" }),
		status: text("status", {
			enum: ["queued", "running", "complete", "failed", "cancelled"],
		}).notNull(),
		totalUnits: integer("total_units").notNull().default(0),
		doneUnits: integer("done_units").notNull().default(0),
		failedUnits: integer("failed_units").notNull().default(0),
		provider: text("provider"),
		model: text("model"),
		/** The job attempt that owns the row; writes from an older attempt are ignored. */
		attemptId: uuid("attempt_id"),
		/** Recently cancelled queue jobs, newest first; none of them may claim the row. */
		cancelledJobIds: uuid("cancelled_job_ids")
			.array()
			.notNull()
			.default(sql`'{}'`),
		lastError: text("last_error"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(t) => [
		check(
			"preprocess_runs_status_ck",
			sql`${t.status} in ('queued','running','complete','failed','cancelled')`,
		),
	],
);
