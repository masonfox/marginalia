import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
	Attachment,
	ComposerState,
} from "#/components/composer/use-composer";
import { attachmentOf } from "#/components/composer/use-composer";
import {
	type Msg,
	type ReplyUsage,
	refOf,
	textOf,
	toMsg,
} from "#/components/conversation-messages";
import type { ThreadAnchor } from "#/lib/composer-draft";
import { THREAD_ID_HEADER } from "#/lib/new-thread";
import { attachmentKey, passageContextPart } from "#/lib/passage-ref";
import { replyContextOf, replyContextPart } from "#/lib/reply-context";
import type { StoredMessage } from "#/modules/conversation";

/** How many times to refetch while a finished reply's usage is not stored yet. */
const USAGE_REFETCHES = 5;

/**
 * Where a surface's messages go: the main conversation, an existing thread,
 * or a new thread started by its first message.
 */
export type ChatTarget =
	| { kind: "main" }
	| { kind: "thread"; threadId: string }
	| { kind: "new-thread"; anchor: ThreadAnchor };

/**
 * One chat surface of a conversation: the main conversation or a thread. It
 * sends only the new message (the server owns the history), recovers from
 * failures, and refetches until a finished reply's usage is stored.
 */
export function useChatSurface({
	chatId,
	conversationId,
	target,
	initial,
	savedCount,
	usage,
	reload,
	refresh,
	onSendStart,
	onThreadCreated,
	findCreatedThread,
}: {
	/** The chat's identity; a new one starts a fresh chat. */
	chatId: string;
	conversationId: string;
	target: ChatTarget;
	/** The stored messages the chat starts with. */
	initial: StoredMessage[];
	/** How many messages are stored, for telling a new submission's echo apart. */
	savedCount: number;
	/** Recorded usage of this surface's replies. */
	usage: Record<string, ReplyUsage>;
	/** The surface's stored messages read again, or null when they are gone. */
	reload: () => Promise<StoredMessage[] | null>;
	/** Reloads the page data, such as usage and thread markers. */
	refresh: () => Promise<void>;
	/** Called as a new message (not a retry) is sent. */
	onSendStart?: () => void;
	/** The server created the new thread this surface's first message started. */
	onThreadCreated?: (threadId: string) => void;
	/**
	 * For a new thread whose creation was never heard of: the thread the server
	 * created for this message, if it can be told apart, so a retry continues it
	 * instead of starting another.
	 */
	findCreatedThread?: (snapshot: Msg) => Promise<string | null>;
}) {
	// Read when a request is made, so a new thread's later turns go to the thread it created.
	const targetRef = useRef(target);
	targetRef.current = target;
	const created = useRef<string | null>(null);
	const threadFields = () => {
		const now = targetRef.current;
		if (created.current) return { threadId: created.current };
		if (now.kind === "thread") return { threadId: now.threadId };
		if (now.kind === "new-thread")
			return {
				newThread: {
					anchorMessageId: now.anchor.anchorMessageId,
					quote: now.anchor.quote,
				},
			};
		return {};
	};
	const onThreadCreatedRef = useRef(onThreadCreated);
	onThreadCreatedRef.current = onThreadCreated;
	/** Records the thread a new-thread surface created, once. */
	const markCreated = (threadId: string) => {
		if (created.current || targetRef.current.kind !== "new-thread") return;
		created.current = threadId;
		onThreadCreatedRef.current?.(threadId);
	};
	const onSendStartRef = useRef(onSendStart);
	onSendStartRef.current = onSendStart;
	// biome-ignore lint/correctness/useExhaustiveDependencies: threadFields and markCreated read refs only
	const transport = useMemo(
		() =>
			new DefaultChatTransport<Msg>({
				api: "/api/chat",
				// The thread's id arrives with the headers, before any stream part.
				fetch: async (input, init) => {
					const res = await fetch(input, init);
					const threadId = res.headers.get(THREAD_ID_HEADER);
					if (threadId) markCreated(threadId);
					return res;
				},
				prepareSendMessagesRequest: ({ messages, trigger }) => {
					const thread = threadFields();
					// The server owns the history: send only the new message, or nothing to retry.
					if (trigger === "regenerate-message") {
						return {
							body: {
								conversationId,
								...("threadId" in thread && thread),
							},
						};
					}
					onSendStartRef.current?.();
					return {
						body: {
							conversationId,
							...thread,
							message: textOf(messages.at(-1)),
							replyContext: replyContextOf(messages.at(-1)?.parts ?? []),
							passageRef: refOf(messages.at(-1)?.parts ?? []),
						},
					};
				},
			}),
		[conversationId],
	);
	// After a stop the server saves the reply (and its usage) after the client
	// is done, so the first refetch can miss it. Retry a few times.
	const [awaitingUsage, setAwaitingUsage] = useState<{
		id: string;
		tries: number;
	} | null>(null);
	const initialMessages = useMemo(
		() => initial.map(toMsg),
		// Only the first render seeds the chat; later updates come from the stream.
		[initial],
	);
	const chat = useChat<Msg>({
		id: chatId,
		messages: initialMessages,
		transport,
		onData: (part) => {
			if (part.type === "data-thread") markCreated(part.data.threadId);
		},
		// Runs after a finish, a stop, and an error alike.
		onFinish: ({ message }) => {
			setAwaitingUsage({ id: message.id, tries: 0 });
			void refresh();
		},
	});
	useEffect(() => {
		if (!awaitingUsage) return;
		if (usage[awaitingUsage.id] || awaitingUsage.tries >= USAGE_REFETCHES) {
			setAwaitingUsage(null);
			return;
		}
		const timer = setTimeout(() => {
			setAwaitingUsage({ ...awaitingUsage, tries: awaitingUsage.tries + 1 });
			void refresh();
		}, 600);
		return () => clearTimeout(timer);
	}, [awaitingUsage, usage, refresh]);

	const { messages, status, error } = chat;
	const busy = status === "submitted" || status === "streaming";
	// The reply the reader stopped, so it can be marked incomplete before it is reloaded.
	const [stoppedId, setStoppedId] = useState<string | null>(null);
	const [recoveryError, setRecoveryError] = useState("");
	const submission = useRef<Msg | null>(null);
	const submissionBase = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new chat has no submission
	useEffect(() => {
		submission.current = null;
	}, [chatId]);

	/** Sends a message and empties the composer and its saved draft. */
	const send = (
		text: string,
		attachment: Attachment | null,
		composer?: ComposerState,
	) => {
		const parts: Msg["parts"] = [
			...(attachment?.kind === "quote"
				? [replyContextPart(attachment.quote)]
				: []),
			...(attachment?.kind === "passage"
				? [passageContextPart(attachment.snapshot)]
				: []),
			{ type: "text", text },
		];
		submissionBase.current = savedCount;
		submission.current = { id: crypto.randomUUID(), role: "user", parts };
		composer?.clear();
		void chat.sendMessage({ id: submission.current.id, parts });
	};

	const last = messages.at(-1);
	const lastStoredError =
		last?.role === "assistant" && last.metadata?.finishReason === "error";
	const failed = status === "error" || lastStoredError;
	const failureText =
		error?.message ??
		(lastStoredError ? last?.metadata?.error : null) ??
		"Something went wrong.";

	const sameMessage = (m: StoredMessage, snapshot: Msg) =>
		m.role === "user" &&
		textOf({ parts: m.parts as Msg["parts"] }) === textOf(snapshot) &&
		attachmentKey(m.parts) === attachmentKey(snapshot.parts);

	/** Adopts the thread a lost new-thread request created, so the reload reads it. */
	const reconcileCreated = async (snapshot: Msg | null | undefined) => {
		if (!snapshot || !findCreatedThread || created.current) return;
		if (targetRef.current.kind !== "new-thread") return;
		const threadId = await findCreatedThread(snapshot);
		if (threadId) markCreated(threadId);
	};

	const retry = async () => {
		setRecoveryError("");
		try {
			const snapshot =
				submission.current ??
				[...messages].reverse().find((m) => m.role === "user");
			await reconcileCreated(snapshot);
			const saved = await reload();
			if (!saved) throw new Error("Could not reload conversation. Try again.");
			const base = snapshot ? submissionBase.current - 1 : -1;
			const accepted =
				snapshot && saved.some((m, i) => i > base && sameMessage(m, snapshot));
			chat.clearError();
			if (accepted || (!submission.current && last?.role === "assistant")) {
				chat.setMessages(saved.map(toMsg));
				const tail = saved.at(-1);
				if (tail?.role === "assistant" && tail.finishReason !== "error") {
					submission.current = null;
					await refresh();
				} else await chat.regenerate();
			} else if (snapshot) {
				chat.setMessages(messages.filter((m) => m.id !== snapshot.id));
				await chat.sendMessage({ id: snapshot.id, parts: snapshot.parts });
			}
		} catch (err) {
			setRecoveryError(
				err instanceof Error
					? err.message
					: "Could not reconcile the submitted message.",
			);
		}
	};

	/** Puts the failed message back in the composer, unless it was already saved. */
	const editFailed = async (composer: ComposerState) => {
		if (composer.draft || composer.attachment) {
			setRecoveryError(
				"Your newer draft is preserved. Clear it before editing the failed message.",
			);
			return;
		}
		try {
			const snapshot = submission.current;
			await reconcileCreated(snapshot);
			const saved = await reload();
			if (!saved || !snapshot)
				throw new Error("Could not reload the submitted message.");
			if (
				saved
					.slice(submissionBase.current)
					.some((m) => sameMessage(m, snapshot))
			) {
				setRecoveryError(
					"This message is already saved. Use Retry to continue its reply.",
				);
				return;
			}
			chat.setMessages(messages.filter((m) => m.id !== snapshot.id));
			chat.clearError();
			composer.restore(textOf(snapshot), attachmentOf(snapshot.parts));
		} catch (err) {
			setRecoveryError(
				err instanceof Error ? err.message : "Could not recover the message.",
			);
		}
	};

	const stop = () => {
		setStoppedId(messages.at(-1)?.id ?? null);
		void chat.stop();
	};

	return {
		chat,
		messages,
		status,
		busy,
		last,
		failed,
		failureText,
		recoveryError,
		/** Whether a submitted message can still be taken back for editing. */
		canEditFailed: submission.current !== null,
		stoppedId,
		send,
		retry,
		editFailed,
		stop,
	};
}

export type ChatSurface = ReturnType<typeof useChatSurface>;
