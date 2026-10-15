import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createEmptyDatabase, createTestDb } from "../../../test/db";
import { createDb } from ".";
import { runMigrations } from "./migrate";

const silent = { info() {}, error() {} };

describe("database", () => {
	it("connects to the test server", async () => {
		const { pool } = await createTestDb();
		const { rows } = await pool.query("select 1 as one");
		expect(rows[0].one).toBe(1);
	});

	it("applies the schema to a fresh database", async () => {
		const { pool } = await createTestDb();
		const { rows } = await pool.query<{ table_name: string }>(
			"select table_name from information_schema.tables where table_schema = 'public' order by 1",
		);
		expect(rows.map((r) => r.table_name)).toEqual([
			"ai_usage",
			"conversation_editions",
			"conversations",
			"editions",
			"excluded_editions",
			"guide_corrections",
			"guide_dismissed_proposals",
			"guide_gloss_exclusions",
			"guide_subject_aliases",
			"guide_subjects",
			"instance_settings",
			"library_files",
			"library_sources",
			"locator_aliases",
			"messages",
			"note_refs",
			"passages",
			"preprocess_runs",
			"reader_notes",
			"reading_positions",
			"sections",
			"sessions",
			"toc_entries",
			"unit_observations",
			"unit_summaries",
		]);
		// The generated tsvector column uses each passage's own search config.
		const ed = await pool.query(
			"insert into editions (sha256, short_id, title) values ('ab', 'ab', 'T') returning id",
		);
		const sec = await pool.query(
			"insert into sections (edition_id, spine_index, href, linear) values ($1, 0, 'a.xhtml', true) returning id",
			[ed.rows[0].id],
		);
		const p = await pool.query(
			`insert into passages (edition_id, section_id, spine_index, block_index, locator, kind, text, cfi, position, reveal_position, search_config)
			 values ($1, $2, 0, 0, 'ab:v1:0.0', 'paragraph', 'The dreamers were dreaming', '/6/2!/4/2', 1, 1, 'english')
			 returning tsv::text`,
			[ed.rows[0].id, sec.rows[0].id],
		);
		expect(p.rows[0].tsv).toBe("'dream':4 'dreamer':2");
	});
});

describe("runMigrations", () => {
	it("applies each migration once when two migrators run concurrently", async () => {
		const url = await createEmptyDatabase();
		const a = createDb(url);
		const b = createDb(url);
		try {
			await Promise.all([
				runMigrations(a.pool, silent),
				runMigrations(b.pool, silent),
			]);
			const { rows } = await a.pool.query(
				"select count(*)::int as n from drizzle.__drizzle_migrations",
			);
			const journal = JSON.parse(
				readFileSync("drizzle/meta/_journal.json", "utf8"),
			);
			expect(rows[0].n).toBe(journal.entries.length);
		} finally {
			await a.pool.end();
			await b.pool.end();
		}
	});

	it("exits non-zero and logs the failure when a migration is broken", async () => {
		const url = await createEmptyDatabase();
		const folder = mkdtempSync(path.join(tmpdir(), "marginalia-migrations-"));
		cpSync("drizzle", folder, { recursive: true });
		const journalPath = path.join(folder, "meta", "_journal.json");
		const journal = JSON.parse(readFileSync(journalPath, "utf8"));
		journal.entries.push({
			idx: journal.entries.length,
			version: "7",
			when: Date.now(),
			tag: "9999_broken",
			breakpoints: true,
		});
		writeFileSync(journalPath, JSON.stringify(journal));
		writeFileSync(
			path.join(folder, "9999_broken.sql"),
			"alter table no_such_table add column x int;",
		);

		const { code, output } = await new Promise<{
			code: number | null;
			output: string;
		}>((resolve) => {
			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/server/db/migrate-cli.ts"],
				{
					env: {
						...process.env,
						DATABASE_URL: url,
						MARGINALIA_MIGRATIONS_DIR: folder,
						LOG_LEVEL: "info",
					},
				},
			);
			let output = "";
			child.stdout.on("data", (d) => {
				output += d;
			});
			child.stderr.on("data", (d) => {
				output += d;
			});
			child.on("close", (code) => resolve({ code, output }));
		});
		expect(code).not.toBe(0);
		expect(output).toContain("database migration failed");
		expect(output).toContain("no_such_table");

		// The earlier migration in the same run is rolled back too: nothing half-applied.
		const client = new pg.Client({ connectionString: url });
		await client.connect();
		const { rows } = await client.query(
			"select to_regclass('public.editions') as t",
		);
		await client.end();
		expect(rows[0].t).toBeNull();
	});
});
