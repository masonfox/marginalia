// The library list's paging cursor: an opaque base64url JSON token. Kept free
// of server code, since the server function's input validator also runs in
// the client bundle.
import { z } from "zod";
import {
	decodeCursorToken,
	encodeCursorToken,
	timestampKey,
} from "./cursor-token";

const cursorSchema = z.object({
	/** lower(title) */
	t: z.string(),
	/** created_at, ISO 8601 UTC with microseconds */
	c: timestampKey,
	i: z.uuid(),
});
export type ShelfCursor = z.infer<typeof cursorSchema>;

export function encodeShelfCursor(cursor: ShelfCursor): string {
	return encodeCursorToken(cursor);
}

/** The cursor's position, or null when it is not one the server issued. */
export function decodeShelfCursor(cursor: string): ShelfCursor | null {
	return decodeCursorToken(cursor, cursorSchema);
}

export function isValidShelfCursor(cursor: string): boolean {
	return decodeShelfCursor(cursor) !== null;
}
