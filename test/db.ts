import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, inject } from "vitest";
import { createDb, type DbHandle } from "#/server/db";
import { runMigrations } from "#/server/db/migrate";

const silent = { info() {}, error() {} };

export function adminUrl(): string {
	return inject("postgresAdminUrl");
}

export function urlForDatabase(name: string): string {
	const url = new URL(adminUrl());
	url.pathname = `/${name}`;
	return url.toString();
}

/** Creates an empty database on the shared test server and returns its URL. */
export async function createEmptyDatabase(): Promise<string> {
	const name = `t_${randomBytes(6).toString("hex")}`;
	const admin = new pg.Client({ connectionString: adminUrl() });
	await admin.connect();
	try {
		await admin.query(`create database ${name}`);
	} finally {
		await admin.end();
	}
	return urlForDatabase(name);
}

export interface TestDb extends DbHandle {
	url: string;
}

/**
 * A fresh, migrated database for the calling test file, closed after the file
 * finishes.
 */
export async function createTestDb(): Promise<TestDb> {
	const url = await createEmptyDatabase();
	const handle = createDb(url);
	await runMigrations(handle.pool, silent);
	afterAll(async () => {
		await handle.pool.end();
	});
	return { ...handle, url };
}
