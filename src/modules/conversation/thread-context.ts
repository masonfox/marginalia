import { projectPassageContext } from "#/lib/passage-ref";
import { projectReplyContext } from "#/lib/reply-context";

/** What a thread is anchored to, as projected into its first message. */
export interface ThreadAnchor {
	messageId: string;
	quote: string;
}

/**
 * The model projection of a thread's first reader message: the anchor quote
 * as labelled, user-selected context from an earlier reply, then the
 * message's own attachments and text as `projectReplyContext` and
 * `projectPassageContext` render them. Never modifies the stored parts.
 */
export function projectThreadAnchor(
	parts: unknown[],
	anchor: ThreadAnchor,
): unknown[] {
	return [
		{
			type: "text",
			text: `Side thread about this excerpt from an earlier assistant response; not verified book evidence. The reader selected it to discuss it on its own. The conversation before this message is the main conversation up to and including that response.\nSource message: ${anchor.messageId}\n<thread-anchor-quote>\n${anchor.quote}\n</thread-anchor-quote>\nThread message:\n`,
		},
		...projectReplyContext(projectPassageContext(parts)),
	];
}
