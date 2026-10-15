import { z } from "zod";
import { replyContextOf } from "./reply-context";

/** The longest referenced text a message may carry, in UTF-16 units. */
export const PASSAGE_REF_LIMIT = 4000;

const rangeSchema = z
	.object({
		start: z.number().int().min(0).max(10_000_000),
		end: z.number().int().min(0).max(10_000_000),
	})
	.refine((r) => r.end > r.start);
export type PassageRange = z.infer<typeof rangeSchema>;

/** The epub module's locator shape (`<short_id>:v<parser_version>:<spine>.<block>`); kept here so this module stays client-safe. */
const locatorSchema = z
	.string()
	.trim()
	.regex(/^[0-9a-f]{12,64}:v\d{1,6}:\d{1,6}\.\d{1,7}$/);

/** A passage, or a character range of its text: the passage view URL's contents. */
export const passageRefSchema = z.object({
	locator: locatorSchema,
	range: rangeSchema.optional(),
});
export type PassageRef = z.infer<typeof passageRefSchema>;

const PATH = /^\/p\/([^/]+)\/?$/;

/**
 * Reads a passage view URL (`/p/<locator>`, optionally `?hl=<start>-<end>`):
 * an absolute URL on `origin`, or a root-relative path. Anything else,
 * including text around the link, returns null.
 */
export function parsePassageLink(
	text: string,
	origin: string,
): PassageRef | null {
	const raw = text.trim();
	if (!raw || /\s/.test(raw)) return null;
	let url: URL;
	try {
		if (raw.startsWith("/")) {
			if (raw.startsWith("//")) return null;
			url = new URL(raw, origin);
		} else {
			url = new URL(raw);
			if (url.origin !== new URL(origin).origin) return null;
		}
	} catch {
		return null;
	}
	const match = PATH.exec(url.pathname);
	if (!match) return null;
	let locator: string;
	try {
		locator = decodeURIComponent(match[1] as string);
	} catch {
		return null;
	}
	const hl = url.searchParams.get("hl");
	let range: PassageRange | undefined;
	if (hl !== null) {
		const m = /^(\d{1,8})-(\d{1,8})$/.exec(hl);
		if (!m) return null;
		range = { start: Number(m[1]), end: Number(m[2]) };
	}
	const ref = passageRefSchema.safeParse({ locator, range });
	return ref.success ? ref.data : null;
}

/** The passage view path for a reference. */
export function passageHref(ref: PassageRef): string {
	const hl = ref.range ? `?hl=${ref.range.start}-${ref.range.end}` : "";
	return `/p/${ref.locator}${hl}`;
}

/** The server-resolved snapshot stored with a user message. */
export const passageSnapshotSchema = z.object({
	/** The current locator when the message was sent. */
	locator: locatorSchema,
	range: rangeSchema.optional(),
	editionId: z.string().min(1),
	bookTitle: z.string(),
	sectionTitle: z.string().nullable(),
	/** The referenced text: the range's slice, or the whole passage. */
	text: z.string().min(1).max(PASSAGE_REF_LIMIT),
});
export type PassageSnapshot = z.infer<typeof passageSnapshotSchema>;
export type StoredPassageContext = PassageSnapshot & { version: 1 };

export function passageContextPart(snapshot: PassageSnapshot) {
	return {
		type: "data-passage-context" as const,
		data: { version: 1 as const, ...snapshot },
	};
}

export function passageContextOf(
	parts: unknown[],
): StoredPassageContext | undefined {
	for (const part of parts) {
		if (!part || typeof part !== "object") continue;
		const p = part as { type?: string; data?: StoredPassageContext };
		if (
			p.type === "data-passage-context" &&
			p.data?.version === 1 &&
			passageSnapshotSchema.safeParse(p.data).success
		)
			return p.data;
	}
}

/** Versioned model projection; never modifies the stored snapshot. */
export function projectPassageContext(parts: unknown[]): unknown[] {
	const passage = passageContextOf(parts);
	if (!passage) return parts;
	const where = passage.sectionTitle
		? `${passage.bookTitle} (${passage.sectionTitle})`
		: passage.bookTitle;
	return [
		{
			type: "text",
			text: `The reader is referring to this passage from ${where}, locator ${passage.locator}. It is quoted from the book.\n<referenced-passage locator="${passage.locator}">\n${passage.text}\n</referenced-passage>\nNew reader message:\n`,
		},
		...parts.filter(
			(p) => (p as { type: string }).type !== "data-passage-context",
		),
	];
}

/** Identifies a message's attachment (reply quote or passage), for matching a submission to its stored copy. */
export function attachmentKey(parts: unknown[]): string {
	const passage = passageContextOf(parts);
	return JSON.stringify([
		replyContextOf(parts) ?? null,
		passage ? { locator: passage.locator, range: passage.range ?? null } : null,
	]);
}
