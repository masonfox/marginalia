import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import type { Logger } from "../logger";

/** Arbitrary constant identifying Marginalia's migration lock. */
const MIGRATION_LOCK_ID = 7_418_224_301;

export const defaultMigrationsFolder = path.resolve(
	process.env.MARGINALIA_MIGRATIONS_DIR ?? "drizzle",
);

/**
 * Applies pending migrations while holding a session-level advisory lock, so
 * concurrently starting instances apply each migration exactly once.
 */
export async function runMigrations(
	pool: pg.Pool,
	log: Pick<Logger, "info" | "error">,
	migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
		try {
			log.info({ migrationsFolder }, "applying database migrations");
			await migrate(drizzle({ client }), { migrationsFolder });
			log.info("database migrations applied");
		} finally {
			await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
		}
	} catch (err) {
		log.error({ err }, "database migration failed");
		throw err;
	} finally {
		client.release();
	}
}

/** Runs migrations and exits the process with status 1 if they fail. */
export async function migrateOrExit(
	pool: pg.Pool,
	log: Pick<Logger, "info" | "error">,
	migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
	try {
		await runMigrations(pool, log, migrationsFolder);
	} catch {
		await pool.end().catch(() => {});
		process.exit(1);
	}
}
