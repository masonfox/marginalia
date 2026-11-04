// The library list's paging cursor: an opaque base64url JSON token. Kept free
// of server code, since the server function's input validator also runs in
// the client bundle.
import { z } from "zod";

const CREATED_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const cursorSchema = z.object({
	/** lower(title) */
	t: z.string(),
	/** created_at, ISO 8601 UTC with microseconds */
	c: z
		.string()
		.regex(CREATED_KEY)
		.refine((s) => {
			const d = new Date(s);
			return (
				!Number.isNaN(d.getTime()) &&
				d.toISOString().slice(0, 23) === s.slice(0, 23)
			);
		}),
	i: z.uuid(),
});
export type ShelfCursor = z.infer<typeof cursorSchema>;

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
	const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function encodeShelfCursor(cursor: ShelfCursor): string {
	return toBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

/** The cursor's position, or null when it is not one the server issued. */
export function decodeShelfCursor(cursor: string): ShelfCursor | null {
	if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
	let value: unknown;
	try {
		const bytes = fromBase64Url(cursor);
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return null;
	}
	const parsed = cursorSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function isValidShelfCursor(cursor: string): boolean {
	return decodeShelfCursor(cursor) !== null;
}
