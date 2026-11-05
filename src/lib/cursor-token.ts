// Opaque paging cursors: base64url JSON tokens validated with zod. Kept free
// of server code, since server function input validators also run in the
// client bundle.
import { z } from "zod";

const TIMESTAMP_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * A timestamptz at full (microsecond) precision, ISO 8601 UTC, as produced
 * by `timestampKeySql`. A JS Date would lose the last three digits.
 */
export const timestampKey = z
	.string()
	.regex(TIMESTAMP_KEY)
	.refine((s) => {
		const d = new Date(s);
		return (
			!Number.isNaN(d.getTime()) &&
			d.toISOString().slice(0, 23) === s.slice(0, 23)
		);
	});

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

export function encodeCursorToken(value: unknown): string {
	return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** The token's value, or null when it is not one `schema` accepts. */
export function decodeCursorToken<T>(
	token: string,
	schema: z.ZodType<T>,
): T | null {
	if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
	let value: unknown;
	try {
		const bytes = fromBase64Url(token);
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return null;
	}
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
