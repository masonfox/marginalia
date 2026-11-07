import { eq, sql } from "drizzle-orm";
import {
	DEFAULT_DISCUSSION_PROMPT,
	discussionPromptError,
} from "#/lib/conversation-prompt";
import type { Executor } from "#/server/db";
import { aiSettings } from "./schema";
/** Reads every time; never caches overrides in process memory. */
export async function getDiscussionPromptOverride(
	db: Executor,
): Promise<string | null> {
	const [row] = await db
		.select({ prompt: aiSettings.discussionPrompt })
		.from(aiSettings)
		.where(eq(aiSettings.id, 1));
	return row?.prompt ?? null;
}
export async function getDiscussionPrompt(db: Executor) {
	const override = await getDiscussionPromptOverride(db);
	return {
		mode: override === null ? ("default" as const) : ("custom" as const),
		text: override ?? DEFAULT_DISCUSSION_PROMPT,
	};
}
export async function saveDiscussionPrompt(db: Executor, input: unknown) {
	const error = discussionPromptError(input);
	if (error) return { error };
	await write(db, input as string);
	return { error: null };
}
export async function resetDiscussionPrompt(db: Executor) {
	await write(db, null);
	return getDiscussionPrompt(db);
}
async function write(db: Executor, discussionPrompt: string | null) {
	await db
		.insert(aiSettings)
		.values({ id: 1, discussionPrompt })
		.onConflictDoUpdate({
			target: aiSettings.id,
			set: { discussionPrompt, updatedAt: sql`now()` },
		});
}
