import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DISCUSSION_PROMPT } from "#/lib/conversation-prompt";
import { createDb } from "#/server/db";
import { runMigrations } from "#/server/db/migrate";
import {
	createEmptyDatabase,
	createTestDb,
	type TestDb,
} from "../../../test/db";
import {
	getDiscussionPrompt,
	getDiscussionPromptOverride,
	resetDiscussionPrompt,
	saveDiscussionPrompt,
} from ".";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
describe("global discussion prompt persistence", () => {
	it("defaults after migration, preserves verbatim custom text across connections, and resets to null", async () => {
		expect(await getDiscussionPrompt(t.db)).toEqual({
			mode: "default",
			text: DEFAULT_DISCUSSION_PROMPT,
		});
		await t.pool.query(
			"insert into ai_settings (id, chat_provider, chat_model) values (1, 'openai', 'saved')",
		);
		expect(await getDiscussionPromptOverride(t.db)).toBeNull();
		const text = "  My grounding and spoiler policy.\n";
		expect(await saveDiscussionPrompt(t.db, text)).toEqual({ error: null });
		const restarted = createDb(t.url);
		try {
			expect(await getDiscussionPrompt(restarted.db)).toEqual({
				mode: "custom",
				text,
			});
		} finally {
			await restarted.pool.end();
		}
		for (const invalid of [
			"",
			" \n\t",
			"x".repeat(32001),
			null,
			{ text: "injected" },
		]) {
			expect((await saveDiscussionPrompt(t.db, invalid)).error).toBeTruthy();
			expect(await getDiscussionPromptOverride(t.db)).toBe(text);
		}
		expect(await saveDiscussionPrompt(t.db, "x".repeat(32000))).toEqual({
			error: null,
		});
		expect(await resetDiscussionPrompt(t.db)).toEqual({
			mode: "default",
			text: DEFAULT_DISCUSSION_PROMPT,
		});
		expect(
			(
				await t.pool.query(
					"select discussion_prompt, chat_model from ai_settings",
				)
			).rows[0],
		).toEqual({ discussion_prompt: null, chat_model: "saved" });
		await saveDiscussionPrompt(t.db, DEFAULT_DISCUSSION_PROMPT);
		expect((await getDiscussionPrompt(t.db)).mode).toBe("custom");
	});
});

it("migrates an existing Settings row without creating an override or changing its model", async () => {
	const folder = await mkdtemp(path.join(os.tmpdir(), "prompt-migration-"));
	const old = createDb(await createEmptyDatabase());
	try {
		const journal = JSON.parse(
			await readFile("drizzle/meta/_journal.json", "utf8"),
		);
		journal.entries = journal.entries.filter(
			(entry: { idx: number }) => entry.idx < 19,
		);
		await mkdir(path.join(folder, "meta"));
		await writeFile(
			path.join(folder, "meta/_journal.json"),
			JSON.stringify(journal),
		);
		for (const entry of journal.entries)
			await copyFile(
				path.join("drizzle", `${entry.tag}.sql`),
				path.join(folder, `${entry.tag}.sql`),
			);
		const silent = { info() {}, error() {} };
		await runMigrations(old.pool, silent, folder);
		await old.pool.query(
			"insert into ai_settings (id,chat_provider,chat_model) values (1,'openai','existing')",
		);
		await runMigrations(old.pool, silent);
		expect(await getDiscussionPrompt(old.db)).toEqual({
			mode: "default",
			text: DEFAULT_DISCUSSION_PROMPT,
		});
		expect(
			(
				await old.pool.query(
					"select chat_model,discussion_prompt from ai_settings",
				)
			).rows,
		).toEqual([{ chat_model: "existing", discussion_prompt: null }]);
	} finally {
		await old.pool.end();
		if (
			path.dirname(folder) === os.tmpdir() &&
			path.basename(folder).startsWith("prompt-migration-")
		)
			await rm(folder, { recursive: true, force: true });
	}
});
