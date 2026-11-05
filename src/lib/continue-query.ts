import { queryOptions } from "@tanstack/react-query";
import { listRecentConversationsFn } from "#/fns/conversations";

/** Conversations shown in the dashboard's Continue section. */
export const CONTINUE_COUNT = 3;

/**
 * The most recently active conversations across all books, for Continue.
 * Under the ["conversations"] prefix, so renames and deletes refresh it.
 */
export const continueQuery = queryOptions({
	queryKey: ["conversations", "recent", CONTINUE_COUNT],
	queryFn: () => listRecentConversationsFn({ data: { limit: CONTINUE_COUNT } }),
});
