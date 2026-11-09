// Recovering a new side thread whose creation the client never heard about:
// the server committed the thread and its first message, but the response
// (or its data-thread part) was lost, so a retry must not start it again.

/** Response header carrying the thread of a thread turn, for clients that read headers. */
export const THREAD_ID_HEADER = "x-marginalia-thread-id";

/** A thread of the conversation as far as adoption needs it. */
export interface ThreadCandidate {
	id: string;
	anchorMessageId: string;
	anchorQuote: string;
}

/** Where a new thread starts: its anchor response and quote. */
export interface NewThreadAnchorRef {
	anchorMessageId: string;
	quote: string;
}

/**
 * Whether a thread could be the one this new-thread panel created: it did not
 * exist when the panel opened, and it has the panel's anchor and quote (which
 * the server stores trimmed).
 */
export function isNewThreadCandidate(
	thread: ThreadCandidate,
	knownIds: ReadonlySet<string>,
	anchor: NewThreadAnchorRef,
): boolean {
	return (
		!knownIds.has(thread.id) &&
		thread.anchorMessageId === anchor.anchorMessageId &&
		thread.anchorQuote === anchor.quote.trim()
	);
}

/**
 * The thread to adopt as the one a lost new-thread request created: the only
 * candidate (see {@link isNewThreadCandidate}) whose first stored user message
 * has the retried message's text. Null when none or several match, so the
 * caller keeps its usual behavior rather than guessing.
 */
export function adoptableThread(
	threads: (ThreadCandidate & { firstUserText: string | null })[],
	knownIds: ReadonlySet<string>,
	anchor: NewThreadAnchorRef,
	text: string,
): string | null {
	const matches = threads.filter(
		(t) =>
			isNewThreadCandidate(t, knownIds, anchor) && t.firstUserText === text,
	);
	return matches.length === 1 ? matches[0].id : null;
}
