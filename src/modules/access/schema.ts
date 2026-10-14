import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { bytea } from "#/server/db/types";

/** Key/value settings, e.g. `password_salt` and `password_hash` (both hex). */
export const instanceSettings = pgTable("instance_settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

export const sessions = pgTable(
	"sessions",
	{
		id: serial("id").primaryKey(),
		/** SHA-256 of the cookie token; the token itself is never stored. */
		tokenHash: bytea("token_hash").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("sessions_expires_idx").on(t.expiresAt)],
);
