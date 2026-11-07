// Progress sync tables (design D4). Provider kinds are not constrained in
// SQL, so adding a provider needs no migration.
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	customType,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { editions } from "#/modules/library";
import type {
	LinkMatchedBy,
	ProviderKind,
	StoredReading,
	SyncSchedule,
} from "./types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => "bytea",
});

/** One configuration per provider kind; the instance shares it. */
export const progressProviders = pgTable(
	"progress_providers",
	{
		kind: text("kind").$type<ProviderKind>().primaryKey(),
		enabled: boolean("enabled").notNull().default(false),
		/** Lower wins when several enabled providers link the same book. */
		priority: smallint("priority").notNull().unique(),
		schedule: text("schedule")
			.$type<SyncSchedule>()
			.notNull()
			.default("manual"),
		/** Plain (non-secret) config fields only. */
		config: jsonb("config")
			.$type<Record<string, string>>()
			.notNull()
			.default({}),
		/** One encrypted JSON object holding every secret field. */
		secretsCiphertext: bytea("secrets_ciphertext"),
		secretsIv: bytea("secrets_iv"),
		secretsTag: bytea("secrets_tag"),
		secretKeyId: text("secret_key_id"),
		lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
		lastSyncMatched: integer("last_sync_matched"),
		lastError: text("last_error"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check(
			"progress_providers_schedule_ck",
			sql`${t.schedule} in ('manual', '1h', '6h', '24h')`,
		),
		check(
			"progress_providers_secrets_ck",
			sql`(${t.secretsCiphertext} is null and ${t.secretsIv} is null and ${t.secretsTag} is null) or (${t.secretsCiphertext} is not null and ${t.secretsIv} is not null and ${t.secretsTag} is not null)`,
		),
	],
);

/** An edition linked to a provider's book. */
export const progressLinks = pgTable(
	"progress_links",
	{
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		providerKind: text("provider_kind")
			.$type<ProviderKind>()
			.notNull()
			.references(() => progressProviders.kind, { onDelete: "cascade" }),
		externalId: text("external_id").notNull(),
		matchedBy: text("matched_by").$type<LinkMatchedBy>().notNull(),
		/** The last raw reading seen. */
		lastReading: jsonb("last_reading").$type<StoredReading>(),
		/** Hash of the normalized reading last applied (design D5). */
		lastFingerprint: text("last_fingerprint"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.editionId, t.providerKind] }),
		unique("progress_links_external_uq").on(t.providerKind, t.externalId),
		check(
			"progress_links_matched_by_ck",
			sql`${t.matchedBy} in ('auto', 'manual')`,
		),
	],
);

/** A list-mode provider's in-progress books with no edition; refreshed each sync. */
export const progressUnmatched = pgTable(
	"progress_unmatched",
	{
		providerKind: text("provider_kind")
			.$type<ProviderKind>()
			.notNull()
			.references(() => progressProviders.kind, { onDelete: "cascade" }),
		externalId: text("external_id").notNull(),
		title: text("title").notNull(),
		authors: jsonb("authors").$type<string[]>().notNull().default([]),
		isbns: jsonb("isbns").$type<string[]>().notNull().default([]),
		reading: jsonb("reading").$type<StoredReading>().notNull(),
		seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.providerKind, t.externalId] })],
);
