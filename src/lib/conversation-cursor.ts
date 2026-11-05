// The conversations list's paging cursor: an opaque base64url JSON token
// holding the last row's (updated_at, created_at, id). Kept free of server
// code, since the server function's input validator also runs in the client
// bundle.
import { z } from "zod";
import {
	decodeCursorToken,
	encodeCursorToken,
	timestampKey,
} from "./cursor-token";

const cursorSchema = z.object({
	/** updated_at, ISO 8601 UTC with microseconds */
	u: timestampKey,
	/** created_at, ISO 8601 UTC with microseconds */
	c: timestampKey,
	i: z.uuid(),
});
export type ConversationCursor = z.infer<typeof cursorSchema>;

export function encodeConversationCursor(cursor: ConversationCursor): string {
	return encodeCursorToken(cursor);
}

/** The cursor's position, or null when it is not one the server issued. */
export function decodeConversationCursor(
	cursor: string,
): ConversationCursor | null {
	return decodeCursorToken(cursor, cursorSchema);
}

export function isValidConversationCursor(cursor: string): boolean {
	return decodeConversationCursor(cursor) !== null;
}

/** Conversations per page of the list across books, and the most one request may ask for. */
export const CONVERSATIONS_PAGE_SIZE = 30;
