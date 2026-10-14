import { z } from "zod";

export const REPLY_CONTEXT_LIMIT = 2000;
export const replyContextSchema = z.object({
	messageId: z.uuid(),
	text: z.string().trim().min(1).max(REPLY_CONTEXT_LIMIT),
});
export type ReplyContext = z.infer<typeof replyContextSchema>;
export type StoredReplyContext = ReplyContext & { version: 1 };
export function replyContextPart(context: ReplyContext) {
	return {
		type: "data-reply-context" as const,
		data: { version: 1 as const, ...context },
	};
}
export function replyContextOf(
	parts: unknown[],
): StoredReplyContext | undefined {
	for (const part of parts) {
		if (!part || typeof part !== "object") continue;
		const p = part as { type?: string; data?: StoredReplyContext };
		if (
			p.type === "data-reply-context" &&
			p.data?.version === 1 &&
			replyContextSchema.safeParse(p.data).success
		)
			return p.data;
	}
}
/** Versioned model projection; never modifies the stored snapshot. */
export function projectReplyContext(parts: unknown[]): unknown[] {
	const quote = replyContextOf(parts);
	if (!quote) return parts;
	return [
		{
			type: "text",
			text: `User-supplied context quoting an earlier assistant response (not verified book evidence).\nSource message: ${quote.messageId}\n<assistant-response-quote>\n${quote.text}\n</assistant-response-quote>\nNew reader message:\n`,
		},
		...parts.filter(
			(p) => (p as { type: string }).type !== "data-reply-context",
		),
	];
}
