import { ArrowLeft, CornerLeftUp, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { UserMarkdown } from "#/components/chat";
import { Composer } from "#/components/composer/composer";
import { useComposer } from "#/components/composer/use-composer";
import {
	AssistantMessage,
	FailureNotice,
	textOf,
	UserMessage,
} from "#/components/conversation-messages";
import { replyModelLabel } from "#/components/model-picker";
import { ReplySelection } from "#/components/reply-selection";
import type { TrailContext } from "#/components/research-trail";
import { Button } from "#/components/ui/button";
import { useChatSurface } from "#/components/use-chat-surface";
import { getThreadFn } from "#/fns/conversations";
import type { DraftSource, ThreadAnchor } from "#/lib/composer-draft";
import type { ReplyContext } from "#/lib/reply-context";
import { guideSteps } from "#/lib/research-trail";
import { exactUsage, totalUsageLine } from "#/lib/usage-format";
import type {
	ConversationBook,
	StoredMessage,
	ThreadWithUsage,
} from "#/modules/conversation";

/** How near the panel's end still counts as "at the end" for following a reply. */
const FOLLOW_SLACK_PX = 80;
const NO_MESSAGES: StoredMessage[] = [];
const NO_USAGE: ThreadWithUsage["usage"] = {};

/**
 * One side thread: the anchor quote, the thread's messages, and its own
 * composer and chat. A side panel on wide screens and a full-screen drawer
 * below the `sm` breakpoint, from the same element, so its chat and draft
 * survive a breakpoint change. Key it by thread (a new thread keeps its key
 * once created), so switching threads starts a fresh chat.
 */
export function ThreadPanel({
	conversationId,
	chatKey,
	thread,
	anchor,
	books,
	aiEnabled,
	trailContext,
	remainingBookIds,
	elsewhere,
	onBusyChange,
	onClose,
	onJumpToAnchor,
	onBringToMain,
	onSaveAsNote,
	onThreadCreated,
	refresh,
}: {
	conversationId: string;
	/** The chat's identity within the conversation. */
	chatKey: string;
	/** The open thread; null for a new thread that has not been sent. */
	thread: ThreadWithUsage | null;
	/** Where the thread starts: its anchor response and quote. */
	anchor: ThreadAnchor;
	books: ConversationBook[];
	aiEnabled: boolean;
	trailContext: TrailContext;
	remainingBookIds: Set<string>;
	/** The main conversation is generating, so sending here waits. */
	elsewhere: boolean;
	onBusyChange: (busy: boolean) => void;
	onClose: () => void;
	onJumpToAnchor: (messageId: string) => void;
	onBringToMain: (quote: ReplyContext) => void;
	onSaveAsNote?: (quote: ReplyContext) => void;
	onThreadCreated: (threadId: string) => void;
	refresh: () => Promise<void>;
}) {
	const threadId = thread?.thread.id ?? null;
	const stored = thread?.messages ?? NO_MESSAGES;
	const usage = thread?.usage ?? NO_USAGE;
	const sources = useMemo(
		() =>
			new Map<string, DraftSource>(
				stored
					.filter((m) => m.role === "assistant" && m.finishReason !== "error")
					.map((m) => [m.id, { threadId: m.threadId }]),
			),
		[stored],
	);
	const composer = useComposer(conversationId, {
		target: threadId ? { kind: "thread", threadId } : { kind: "new-thread" },
		anchor,
		sources,
		books,
		aiEnabled,
	});
	const createdId = useRef<string | null>(null);
	const surface = useChatSurface({
		chatId: `${conversationId}:thread:${chatKey}`,
		conversationId,
		target: threadId
			? { kind: "thread", threadId }
			: { kind: "new-thread", anchor },
		initial: stored,
		savedCount: stored.length,
		usage,
		reload: async () => {
			const id = threadId ?? createdId.current;
			// A new thread that was never created has nothing stored yet.
			if (!id) return [];
			const saved = await getThreadFn({
				data: { conversationId, threadId: id },
			});
			return saved?.messages ?? null;
		},
		refresh,
		onThreadCreated: (id) => {
			createdId.current = id;
			onThreadCreated(id);
		},
	});
	const { messages, busy, status, last } = surface;

	const onBusyChangeRef = useRef(onBusyChange);
	onBusyChangeRef.current = onBusyChange;
	useEffect(() => {
		onBusyChangeRef.current(busy);
	}, [busy]);
	useEffect(() => () => onBusyChangeRef.current(false), []);

	const panel = useRef<HTMLElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	// A new thread focuses its input; an existing one focuses the panel itself.
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per opened thread
	useLayoutEffect(() => {
		if (!threadId) composer.inputRef.current?.focus();
		else panel.current?.focus({ preventScroll: true });
	}, [chatKey]);

	// Follow new content while the reader is at the panel's end.
	const following = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow new content
	useEffect(() => {
		const el = scroller.current;
		if (!el || !following.current) return;
		el.scrollTop = el.scrollHeight;
	}, [messages, status]);

	const savedIds = useMemo(
		() =>
			new Set(stored.filter((m) => m.role === "assistant").map((m) => m.id)),
		[stored],
	);
	const guideContexts = useMemo(
		() => new Map(stored.map((m) => [m.id, m.guideContext])),
		[stored],
	);
	const producers = useMemo(
		() =>
			new Map(stored.map((m) => [m.id, replyModelLabel(m.provider, m.model)])),
		[stored],
	);
	const total = thread?.usageTotal;
	const hasTotal =
		total && (total.inputTokens !== null || total.outputTokens !== null);

	return (
		<aside
			ref={panel}
			tabIndex={-1}
			aria-label="Thread"
			data-selection-scope
			data-testid="thread-panel"
			className="fixed inset-0 z-40 flex h-dvh flex-col bg-background outline-none sm:sticky sm:top-0 sm:z-auto sm:w-[min(440px,42vw)] sm:shrink-0 sm:border-l"
			onKeyDown={(e) => {
				if (e.key !== "Escape" || e.defaultPrevented) return;
				// Escape first dismisses a selection's actions.
				const selection = window.getSelection();
				if (
					selection &&
					!selection.isCollapsed &&
					panel.current?.contains(selection.anchorNode)
				)
					return;
				e.preventDefault();
				onClose();
			}}
		>
			<ReplySelection
				container={panel}
				onAttach={aiEnabled ? composer.attachQuote : undefined}
				onBringToMain={aiEnabled ? onBringToMain : undefined}
				onTooLong={composer.rejectLongQuote}
				onSaveAsNote={onSaveAsNote}
			/>
			<header className="flex flex-none items-center gap-2 border-b px-2 py-2 sm:px-4">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="sm:hidden pointer-coarse:h-11"
					aria-label="Back to the conversation"
					onClick={onClose}
				>
					<ArrowLeft aria-hidden />
					Conversation
				</Button>
				<h2 className="font-serif text-xl font-semibold max-sm:sr-only">
					Thread
				</h2>
				{hasTotal && total && (
					<p
						className="ml-auto min-w-0 truncate text-[13px] text-faint-foreground tabular-nums"
						title={exactUsage(total)}
						data-testid="thread-usage-total"
					>
						{totalUsageLine(total)}
					</p>
				)}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={hasTotal ? "max-sm:hidden" : "ml-auto max-sm:hidden"}
					aria-label="Close thread"
					title="Close thread"
					onClick={onClose}
				>
					<X aria-hidden />
				</Button>
			</header>
			<div
				ref={scroller}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5"
				onScroll={(e) => {
					const el = e.currentTarget;
					following.current =
						el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
				}}
			>
				<figure
					className="mt-4 rounded-lg border-l-2 border-amber bg-muted/40 px-3 py-2 text-sm"
					data-reply-excluded
					data-testid="thread-anchor"
				>
					<figcaption className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-muted-foreground">
						From an assistant response
						<button
							type="button"
							className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-amber-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring pointer-coarse:min-h-11"
							onClick={() => onJumpToAnchor(anchor.anchorMessageId)}
						>
							<CornerLeftUp className="size-3.5" aria-hidden />
							Show in conversation
						</button>
					</figcaption>
					<blockquote className="mt-1 line-clamp-6 whitespace-pre-wrap">
						{anchor.quote}
					</blockquote>
				</figure>
				<ol className="space-y-6 py-6" aria-live="polite">
					{messages.length === 0 && (
						<li className="text-sm text-muted-foreground">
							Ask about this passage. The thread sees the conversation up to
							this response; the main conversation never sees the thread.
						</li>
					)}
					{messages.map((m) => (
						<li key={m.id}>
							{m.role === "user" ? (
								<UserMessage message={m}>
									<UserMarkdown text={textOf(m)} />
								</UserMessage>
							) : (
								<AssistantMessage
									message={m}
									eligible={savedIds.has(m.id) && !(busy && m.id === last?.id)}
									guideSteps={guideSteps(guideContexts.get(m.id), books)}
									trailContext={trailContext}
									remainingBookIds={remainingBookIds}
									stopped={m.id === surface.stoppedId}
									streaming={busy && m.id === last?.id}
									usage={usage[m.id]}
									producedBy={producers.get(m.id) ?? null}
								/>
							)}
						</li>
					))}
					{status === "submitted" && (
						<li className="text-sm text-muted-foreground">Thinking…</li>
					)}
					{surface.failed && (
						<FailureNotice surface={surface} composer={composer} />
					)}
				</ol>
			</div>
			{aiEnabled && (
				<div className="flex-none px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-4">
					<Composer
						composer={composer}
						conversationId={conversationId}
						books={books}
						busy={busy}
						elsewhere={elsewhere}
						label="Thread message"
						onStop={surface.stop}
						onSend={() =>
							surface.send(composer.draft, composer.attachment, composer)
						}
					/>
				</div>
			)}
		</aside>
	);
}
