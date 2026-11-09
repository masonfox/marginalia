import {
	createFileRoute,
	Link,
	notFound,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { z } from "zod";
import { coverColors } from "#/components/book-cover";
import { AiSetupNotice, modelInEffect, UserMarkdown } from "#/components/chat";
import { Composer } from "#/components/composer/composer";
import { useComposer } from "#/components/composer/use-composer";
import {
	ConversationActions,
	ConversationModelControl,
	PositionOfferProvider,
	PositionUpdateOffer,
	useConversationModel,
} from "#/components/conversation-controls";
import {
	AssistantMessage,
	FailureNotice,
	textOf,
	UserMessage,
} from "#/components/conversation-messages";
import { replyModelLabel, selectionLabel } from "#/components/model-picker";
import { ScopePill } from "#/components/pieces";
import {
	ReplySelection,
	SaveNoteBookDialog,
} from "#/components/reply-selection";
import {
	PromptScopeNotice as ScopeNotice,
	scopeText,
	WidenScope,
} from "#/components/scope";
import { ThreadMarkers } from "#/components/thread-markers";
import { ThreadPanel } from "#/components/thread-panel";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { useChatSurface } from "#/components/use-chat-surface";
import {
	getAiStatusFn,
	getConversationFn,
	getThreadFn,
} from "#/fns/conversations";
import { useHydrated } from "#/hooks/use-hydrated";
import {
	beginNamingTracking,
	useNamingMetadata,
} from "#/hooks/use-naming-metadata";
import {
	type DraftSource,
	loadComposerDraft,
	loadNewThreadDraft,
	restorableNewThreadDraft,
	saveNewThreadDraft,
	type ThreadAnchor,
} from "#/lib/composer-draft";
import { excerptNoteDraft } from "#/lib/note-prefill";
import type { ReplyContext } from "#/lib/reply-context";
import { guideSteps } from "#/lib/research-trail";
import { exactUsage, totalUsageLine } from "#/lib/usage-format";
import type {
	ConversationBook,
	ConversationWithUsage,
	ThreadSummary,
} from "#/modules/conversation";

/** How near the page end still counts as "at the end" for following a reply. */
const FOLLOW_SLACK_PX = 80;
/** Below this width a thread opens as a full-screen drawer (Tailwind's `sm`). */
const NARROW_QUERY = "(max-width: 639px)";

const searchSchema = z.object({
	// A passage reference handed over from the passage view; removed once attached.
	ref: z.string().max(100).optional(),
	hl: z.string().max(20).optional(),
	/** The open side thread, or "new" for a thread whose first message is not sent yet. */
	thread: z
		.union([z.uuid(), z.literal("new")])
		.optional()
		.catch(undefined),
});
type ConversationSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/c/$conversationId")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ thread: search.thread }),
	loader: async ({ params, deps }) => {
		if (!z.uuid().safeParse(params.conversationId).success) throw notFound();
		const conversationId = params.conversationId;
		const threadId =
			deps.thread && deps.thread !== "new" ? deps.thread : undefined;
		const [conversation, status, thread] = await Promise.all([
			getConversationFn({ data: { conversationId } }),
			getAiStatusFn(),
			// An unknown or foreign thread loads as null and opens no panel.
			threadId
				? getThreadFn({ data: { conversationId, threadId } })
				: Promise.resolve(null),
		]);
		if (!conversation) throw notFound();
		return { conversation, status, thread };
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `${loaderData.conversation.title} · Marginalia`
					: "Marginalia",
			},
		],
	}),
	component: ConversationPage,
});

/** The search without the open thread. */
const withoutThread = ({ thread: _, ...rest }: ConversationSearch) => rest;

/** The new thread this page started (or restored), and the thread it became once sent. */
interface NewThread {
	key: string;
	anchor: ThreadAnchor;
	createdId?: string;
}

function ConversationPage() {
	const {
		conversation: loadedConversation,
		status: aiStatus,
		thread: loadedThread,
	} = Route.useLoaderData();
	const conversation = useNamingMetadata(loadedConversation);
	const router = useRouter();
	const conversationId = conversation.id;
	useEffect(() => {
		if (conversation.deleted) void router.navigate({ to: "/conversations" });
	}, [conversation.deleted, router]);
	// The model the next reply uses; without one, guidance replaces the composer.
	const effect = modelInEffect(aiStatus, conversation.model);
	const aiEnabled = effect.status === "ok";
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	// Below sm the scope and model controls start collapsed, so the header stays short.
	const [controlsOpen, setControlsOpen] = useState(false);
	const controlsId = useId();
	const collapsed = controlsOpen ? undefined : "max-sm:hidden";
	const conversationModel = useConversationModel(conversationId);
	const hydrated = useHydrated();

	const refresh = useCallback(() => router.invalidate(), [router]);
	const main = useChatSurface({
		chatId: conversationId,
		conversationId,
		target: { kind: "main" },
		initial: conversation.messages,
		savedCount: conversation.messages.length,
		usage: conversation.usage,
		reload: async () =>
			(await getConversationFn({ data: { conversationId } }))?.messages ?? null,
		refresh,
		onSendStart: () => beginNamingTracking(conversationId),
	});
	const { messages, status, busy, last } = main;
	// One generation at a time across the conversation and its threads.
	const [threadBusy, setThreadBusy] = useState(false);
	const anyBusy = busy || threadBusy;
	const remainingBookIds = useMemo(
		() => new Set(conversation.books.map((b) => b.editionId)),
		[conversation.books],
	);
	const savedAssistantIds = useMemo(
		() =>
			new Set(
				conversation.messages
					.filter((m) => m.role === "assistant")
					.map((m) => m.id),
			),
		[conversation.messages],
	);
	/** Saved replies a quote or a new thread's anchor may come from, with their threads. */
	const sources = useMemo(() => {
		const map = new Map<string, DraftSource>();
		for (const m of conversation.messages)
			if (m.role === "assistant") map.set(m.id, { threadId: null });
		for (const [id, threadId] of Object.entries(conversation.threadReplies))
			map.set(id, { threadId });
		for (const m of loadedThread?.messages ?? [])
			if (m.role === "assistant" && m.finishReason !== "error")
				map.set(m.id, { threadId: m.threadId });
		return map;
	}, [conversation.messages, conversation.threadReplies, loadedThread]);

	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const composer = useComposer(conversationId, {
		target: { kind: "main" },
		sources,
		books: conversation.books,
		aiEnabled,
		handoff: search,
		clearHandoff: () =>
			void navigate({
				search: (s) => ({ thread: s.thread }),
				replace: true,
				resetScroll: false,
			}),
	});

	// The book page created this conversation and saved its first message as
	// the draft: send it once. The flag is dropped from history first, so a
	// reload or back/forward finds the message sent, or still in the composer.
	// Sending waits a tick: StrictMode's effect re-run stops the chat first.
	const autoSend = useRouterState({ select: (s) => s.location.state.autoSend });
	const autoSent = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per handed-over conversation
	useEffect(() => {
		if (!autoSend || autoSent.current === conversationId) return;
		const timer = setTimeout(() => {
			autoSent.current = conversationId;
			const { autoSend: _, ...state } = router.history.location.state;
			router.history.replace(router.history.location.href, state);
			const saved = loadComposerDraft(conversationId);
			if (
				aiEnabled &&
				conversation.messages.length === 0 &&
				messages.length === 0 &&
				saved?.text.trim() &&
				!saved.attachment
			)
				main.send(saved.text, null, composer);
		});
		return () => clearTimeout(timer);
	}, [autoSend, conversationId]);
	// Follow new content while the reader is at the end of the page; scrolling
	// up to read stops following until they return. The composer sits in flow
	// at the end, so the page end shows the last message just above it.
	const following = useRef(true);
	useEffect(() => {
		const onScroll = () => {
			const el = document.scrollingElement ?? document.documentElement;
			following.current =
				el.scrollHeight - el.scrollTop - window.innerHeight < FOLLOW_SLACK_PX;
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);
	// Sending a message always returns to the end.
	const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-pin on each new message
	useEffect(() => {
		following.current = true;
	}, [lastUserId]);
	const pendingFollow = useRef(0);
	useEffect(() => () => cancelAnimationFrame(pendingFollow.current), []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow new content
	useEffect(() => {
		if (!following.current || pendingFollow.current) return;
		// At most one scroll per frame, after layout, and only ever downward:
		// nudging up and back per chunk makes mobile toolbars (and dvh) bounce.
		pendingFollow.current = requestAnimationFrame(() => {
			pendingFollow.current = 0;
			if (!following.current) return;
			const el = document.scrollingElement ?? document.documentElement;
			if (el.scrollHeight - el.clientHeight - el.scrollTop > 1)
				window.scrollTo({ top: el.scrollHeight, behavior: "instant" });
		});
	}, [messages, status]);

	// --- Side threads -------------------------------------------------------

	const [newThread, setNewThread] = useState<NewThread | null>(null);
	// A reload with the new thread open reopens it from its draft, if its anchor is still here.
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per opened new thread
	useEffect(() => {
		if (search.thread !== "new" || newThread) return;
		const draft = restorableNewThreadDraft(
			loadNewThreadDraft(conversationId),
			sources,
		);
		if (draft)
			setNewThread({ key: `new:${crypto.randomUUID()}`, anchor: draft.anchor });
	}, [search.thread, conversationId]);
	/** The panel's thread, when one is open. */
	const panel = useMemo(() => {
		if (search.thread === "new")
			return hydrated && newThread
				? { key: newThread.key, thread: null, anchor: newThread.anchor }
				: null;
		if (!search.thread) return null;
		if (loadedThread?.thread.id !== search.thread)
			// Just created and not loaded yet: keep the same chat open meanwhile.
			return newThread?.createdId === search.thread
				? { key: newThread.key, thread: null, anchor: newThread.anchor }
				: null;
		const t = loadedThread.thread;
		return {
			key: newThread?.createdId === t.id ? newThread.key : t.id,
			thread: loadedThread,
			anchor: { anchorMessageId: t.anchorMessageId, quote: t.anchorQuote },
		};
	}, [search.thread, loadedThread, newThread, hydrated]);
	const panelOpen = panel !== null;

	/** This page pushed the history entry that opened the panel, so closing can go back. */
	const pushedPanel = useRef(false);
	useEffect(() => {
		if (!search.thread) pushedPanel.current = false;
	}, [search.thread]);
	/** Opens a thread (or the new thread), replacing an open one in place. */
	const showThread = (thread: string) => {
		const replace = Boolean(search.thread);
		if (!replace) pushedPanel.current = true;
		void navigate({
			search: (s) => ({ ...s, thread }),
			replace,
			resetScroll: false,
		});
	};
	const closePanel = () => {
		if (pushedPanel.current) {
			pushedPanel.current = false;
			router.history.back();
			return;
		}
		void navigate({ search: withoutThread, replace: true, resetScroll: false });
	};
	/** Work waiting for the drawer to close: focusing the composer or showing the anchor. */
	const afterClose = useRef<(() => void) | null>(null);
	useEffect(() => {
		if (panelOpen || !afterClose.current) return;
		const run = afterClose.current;
		afterClose.current = null;
		// After the navigation's own scroll restoration.
		requestAnimationFrame(() => requestAnimationFrame(run));
	}, [panelOpen]);
	const narrow = () => window.matchMedia(NARROW_QUERY).matches;
	/** Runs now beside a side panel, or once the phone drawer has closed. */
	const inMainConversation = (run: () => void) => {
		if (panelOpen && narrow()) {
			afterClose.current = run;
			closePanel();
		} else run();
	};

	const startThread = (quote: ReplyContext) => {
		const anchor = { anchorMessageId: quote.messageId, quote: quote.text };
		// One new thread per conversation: a new selection replaces the last.
		saveNewThreadDraft(conversationId, { text: "", attachment: null, anchor });
		setNewThread({ key: `new:${crypto.randomUUID()}`, anchor });
		showThread("new");
	};
	const onThreadCreated = (threadId: string) => {
		setNewThread((current) => current && { ...current, createdId: threadId });
		// The loader reruns for the new address, refreshing the markers.
		void navigate({
			search: (s) => ({ ...s, thread: threadId }),
			replace: true,
			resetScroll: false,
		});
	};
	const bringToMain = (quote: ReplyContext) => {
		composer.attachQuote(quote);
		inMainConversation(() => composer.inputRef.current?.focus());
	};
	const jumpToAnchor = (messageId: string) =>
		inMainConversation(() =>
			document
				.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
				?.scrollIntoView({ block: "center" }),
		);
	const threadsByAnchor = useMemo(() => {
		const map = new Map<string, ThreadSummary[]>();
		for (const t of conversation.threads)
			map.set(t.anchorMessageId, [...(map.get(t.anchorMessageId) ?? []), t]);
		return map;
	}, [conversation.threads]);
	/** The thread holding a quoted reply, for "from a thread" labels. */
	const threadOf = (messageId: string) =>
		conversation.quoteSourceThreads[messageId] ??
		conversation.threadReplies[messageId];

	/** The main conversation, where its selection actions apply. */
	const surface = useRef<HTMLElement>(null);

	// "Save as note": the excerpt waiting for the reader to choose its book.
	const [noteExcerpt, setNoteExcerpt] = useState<string | null>(null);
	/** Opens the note editor for a book with the excerpt prefilled; nothing is saved yet. */
	const openNoteDraft = (excerpt: string, editionId: string) => {
		const book = conversation.books.find((b) => b.editionId === editionId);
		if (!book) return;
		void router.navigate({
			to: "/books/$editionId/guide/notes/new",
			params: { editionId },
			state: (prev) => ({
				...prev,
				noteDraft: excerptNoteDraft({
					excerpt,
					conversation: { id: conversation.id, title: conversation.title },
					book,
				}),
			}),
		});
	};
	const saveAsNote = (quote: ReplyContext) => {
		const [only] = conversation.books;
		if (conversation.books.length === 1 && only)
			openNoteDraft(quote.text, only.editionId);
		else setNoteExcerpt(quote.text);
	};
	const trailContext = useMemo(
		() => ({
			conversationId,
			books: conversation.books.map((b) => ({
				editionId: b.editionId,
				ordinal: b.ordinal,
				title: b.title,
			})),
		}),
		[conversationId, conversation.books],
	);
	const guideContexts = useMemo(
		() => new Map(conversation.messages.map((m) => [m.id, m.guideContext])),
		[conversation.messages],
	);
	// The model that wrote each stored reply, named in its usage details.
	const producers = useMemo(
		() =>
			new Map(
				conversation.messages.map((m) => [
					m.id,
					replyModelLabel(m.provider, m.model),
				]),
			),
		[conversation.messages],
	);

	return (
		<PositionOfferProvider>
			<div className="flex items-start">
				<main
					ref={surface}
					data-selection-scope
					className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[960px] min-w-0 flex-1 flex-col px-4 py-8 sm:px-8 sm:py-12 max-sm:pt-5"
				>
					<ReplySelection
						key={conversationId}
						container={surface}
						onAttach={aiEnabled ? composer.attachQuote : undefined}
						onThread={aiEnabled ? startThread : undefined}
						onTooLong={composer.rejectLongQuote}
						onSaveAsNote={
							conversation.books.length > 0 ? saveAsNote : undefined
						}
					/>
					<SaveNoteBookDialog
						books={noteExcerpt === null ? null : conversation.books}
						onChoose={(editionId) => {
							if (noteExcerpt) openNoteDraft(noteExcerpt, editionId);
							setNoteExcerpt(null);
						}}
						onCancel={() => setNoteExcerpt(null)}
					/>
					<header
						className="border-b pb-6 max-sm:pb-3"
						data-testid="chat-header"
					>
						{/* With no books left, the header's navigation is the way out. */}
						{/* Several books: the conversations page, where it is listed with every other. */}
						{conversation.books.length > 1 ? (
							<p className="text-sm">
								<Link
									to="/conversations"
									className="text-muted-foreground hover:underline"
								>
									← Conversations
								</Link>
							</p>
						) : (
							conversation.books[0] && (
								<p className="text-sm">
									<Link
										to="/books/$editionId"
										params={{ editionId: conversation.books[0].editionId }}
										className="text-muted-foreground hover:underline"
									>
										← Conversations
									</Link>
								</p>
							)
						)}
						<div className="mt-3 flex items-start gap-3 max-sm:mt-2">
							{/* Below sm: the title and the books take one line each. */}
							<h1
								className="min-w-0 flex-1 font-serif text-[clamp(36px,4vw,52px)] leading-[1.06] font-semibold tracking-[-0.015em] max-sm:truncate"
								title={conversation.title}
							>
								{conversation.title}
							</h1>
							<ConversationActions
								conversationId={conversationId}
								title={conversation.title}
								className="mt-1 -mr-2 sm:mt-2"
								onDeleted={() => {
									composer.clear();
									const book = conversation.books[0];
									return book
										? router.navigate({
												to: "/books/$editionId",
												params: { editionId: book.editionId },
											})
										: router.navigate({ to: "/" });
								}}
							/>
						</div>
						<div className="mt-5 flex flex-wrap items-center gap-2 max-sm:mt-3">
							<div
								className="flex min-w-0 items-center gap-2 max-sm:flex-1 max-sm:overflow-hidden sm:flex-wrap"
								data-testid="conversation-books"
							>
								{conversation.books.length === 0 ? (
									<span className="text-sm text-muted-foreground">No book</span>
								) : (
									conversation.books.map((b) => (
										<BookChip key={b.editionId} book={b} />
									))
								)}
							</div>
							{(conversation.books.length > 0 ||
								effect.status !== "disabled") && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="shrink-0 text-foreground sm:hidden pointer-coarse:h-11"
									aria-expanded={controlsOpen}
									aria-controls={`${controlsId}-model ${controlsId}-scope`}
									onClick={() => setControlsOpen((open) => !open)}
								>
									Scope and model
									<ChevronDown
										aria-hidden
										className={cn(
											"transition-transform",
											controlsOpen && "rotate-180",
										)}
									/>
								</Button>
							)}
							{conversation.books.length > 0 && (
								<ul
									id={`${controlsId}-scope`}
									className={cn(
										"flex flex-wrap items-center gap-2 max-sm:w-full",
										collapsed,
									)}
								>
									{conversation.books.map((b) => (
										<li key={b.editionId} className="flex items-center gap-2">
											<ScopePill
												data-testid="scope-chip"
												className="min-h-9 px-4 pointer-coarse:min-h-11"
											>
												{conversation.books.length > 1 && `${b.title}: `}
												{scopeText(b.scopeLabel)}
											</ScopePill>
											<WidenScope
												conversationId={conversationId}
												book={b}
												disabled={anyBusy}
												variant="outline"
												className="h-9 rounded-full px-4 font-medium pointer-coarse:h-11"
											/>
										</li>
									))}
								</ul>
							)}
							<div
								id={`${controlsId}-model`}
								className={cn(
									"flex min-w-0 items-center gap-3 max-sm:w-full sm:ml-auto",
									collapsed,
								)}
							>
								<ConversationModelControl
									conversationId={conversationId}
									status={aiStatus}
									own={conversation.model}
									effect={effect}
									disabled={anyBusy}
									open={modelPickerOpen}
									onOpenChange={setModelPickerOpen}
								/>
								<UsageSummary
									total={conversation.usageTotal}
									naming={conversation.namingUsage}
								/>
							</div>
						</div>
						<div className={cn("mt-4", collapsed)}>
							<ScopeNotice
								plain
								labels={conversation.books.map((b) => b.scopeLabel)}
								titles={conversation.books.map((b) => b.title)}
							/>
						</div>
						<PositionUpdateOffer />
					</header>

					<ol className="min-w-0 flex-1 space-y-8 py-8" aria-live="polite">
						{messages.length === 0 && (
							<li className="space-y-3 text-sm text-muted-foreground">
								{effect.status === "ok" && (
									<p data-testid="provider-notice">
										Your messages and the passages the assistant reads are sent
										to {selectionLabel(effect.selection)}.
									</p>
								)}
								<p>
									Ask about a scene, a character, or a theory you are forming.
									The assistant will search the book and push back where the
									text does not support you.
								</p>
							</li>
						)}
						{messages.map((m) => {
							const anchored = threadsByAnchor.get(m.id);
							return (
								<li key={m.id}>
									{m.role === "user" ? (
										<UserMessage
											message={m}
											threadOf={threadOf}
											onOpenThread={showThread}
										>
											<UserMarkdown text={textOf(m)} />
										</UserMessage>
									) : (
										<AssistantMessage
											message={m}
											eligible={
												savedAssistantIds.has(m.id) &&
												!(busy && m.id === last?.id)
											}
											guideSteps={guideSteps(
												guideContexts.get(m.id),
												conversation.books,
											)}
											trailContext={trailContext}
											remainingBookIds={remainingBookIds}
											stopped={m.id === main.stoppedId}
											streaming={busy && m.id === last?.id}
											usage={conversation.usage[m.id]}
											producedBy={producers.get(m.id) ?? null}
										>
											{anchored && (
												<ThreadMarkers
													messageId={m.id}
													threads={anchored}
													revision={m}
													onOpen={showThread}
												/>
											)}
										</AssistantMessage>
									)}
								</li>
							);
						})}
						{status === "submitted" && (
							<li className="text-sm text-muted-foreground">Thinking…</li>
						)}
						{main.failed && (
							<FailureNotice surface={main} composer={composer} />
						)}
					</ol>

					{effect.status === "ok" ? (
						// The page background below the card and a fade above it, so messages
						// scroll under the composer. Only the card itself takes the pointer.
						<div className="pointer-events-none sticky bottom-0 z-10 -mx-2 bg-gradient-to-t from-background from-75% to-transparent px-2 pt-8 pb-3 *:pointer-events-auto">
							<Composer
								composer={composer}
								conversationId={conversationId}
								books={conversation.books}
								busy={busy}
								elsewhere={threadBusy}
								onStop={main.stop}
								onSend={() =>
									main.send(composer.draft, composer.attachment, composer)
								}
							/>
						</div>
					) : (
						<AiSetupNotice
							effect={effect}
							actions={
								effect.status !== "disabled" && (
									<>
										{aiStatus.providers.length > 0 && (
											<Button
												type="button"
												size="sm"
												disabled={anyBusy}
												onClick={() => setModelPickerOpen(true)}
											>
												Choose a model
											</Button>
										)}
										{effect.status === "unavailable" && effect.own && (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={anyBusy || conversationModel.busy}
												onClick={() => void conversationModel.save(null)}
											>
												Use the default
											</Button>
										)}
										{conversationModel.error && (
											<p role="alert" className="text-destructive-foreground">
												{conversationModel.error}
											</p>
										)}
									</>
								)
							}
						/>
					)}
				</main>
				{panel && (
					<ThreadPanel
						key={panel.key}
						conversationId={conversationId}
						chatKey={panel.key}
						thread={panel.thread}
						anchor={panel.anchor}
						books={conversation.books}
						aiEnabled={aiEnabled}
						trailContext={trailContext}
						remainingBookIds={remainingBookIds}
						elsewhere={busy}
						onBusyChange={setThreadBusy}
						onClose={closePanel}
						onJumpToAnchor={jumpToAnchor}
						onBringToMain={bringToMain}
						onSaveAsNote={
							conversation.books.length > 0 ? saveAsNote : undefined
						}
						onThreadCreated={onThreadCreated}
						refresh={refresh}
					/>
				)}
			</div>
		</PositionOfferProvider>
	);
}

/** A book of the conversation as a pill: its cover (or cloth color) and title, linking to the book. */
function BookChip({ book }: { book: ConversationBook }) {
	return (
		<Link
			to="/books/$editionId"
			params={{ editionId: book.editionId }}
			className="inline-flex h-9 max-w-full min-w-0 shrink items-center gap-2 rounded-full border border-input py-1 pr-4 pl-1.5 text-sm font-medium text-foreground transition-colors outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring pointer-coarse:h-11"
		>
			<span
				aria-hidden
				className="block h-[26px] w-[18px] shrink-0 overflow-hidden rounded-[2px_3px_3px_2px] shadow-cover"
				style={book.hasCover ? undefined : coverColors(book.title)}
			>
				{book.hasCover && (
					<img
						src={`/api/covers/${book.editionId}`}
						alt=""
						className="size-full object-cover"
					/>
				)}
			</span>
			<span className="truncate">{book.title}</span>
		</Link>
	);
}

/**
 * The running total in the header, opening the exact figures and title
 * naming's usage. Costs are estimates; replies without usage are counted
 * out loud.
 */
function UsageSummary({
	total,
	naming,
}: {
	total: ConversationWithUsage["usageTotal"];
	naming: ConversationWithUsage["namingUsage"];
}) {
	const [open, setOpen] = useState(false);
	const hasUsage = total.inputTokens !== null || total.outputTokens !== null;
	const hasNaming = Boolean(naming && (naming.rows.length || naming.missing));
	if (!hasUsage && total.missing === 0 && !hasNaming) return null;
	const missing =
		total.missing > 0
			? `${total.missing} ${total.missing === 1 ? "reply has" : "replies have"} no recorded usage`
			: null;
	const line =
		[hasUsage && totalUsageLine(total), missing].filter(Boolean).join(" · ") ||
		"Usage";
	return (
		<>
			<button
				type="button"
				className="min-w-0 cursor-pointer truncate rounded-sm text-[13px] text-faint-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring pointer-coarse:min-h-11"
				title={hasUsage ? exactUsage(total) : undefined}
				onClick={() => setOpen(true)}
				data-testid="usage-total"
			>
				{line}
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Usage</DialogTitle>
						<DialogDescription>
							Token counts as the providers reported them. Costs are estimates.
						</DialogDescription>
					</DialogHeader>
					{hasUsage && (
						<p className="text-sm whitespace-pre-line tabular-nums">
							{exactUsage(total)}
						</p>
					)}
					{missing && <p className="text-sm">{missing}.</p>}
					{naming && hasNaming && (
						<section
							className="space-y-1 text-sm tabular-nums"
							data-testid="naming-usage"
						>
							<h3 className="font-semibold">
								Title naming
								{naming.incomplete
									? " (incomplete)"
									: naming.unknown
										? " (unknown usage)"
										: ""}
							</h3>
							{naming.rows.map((row) => (
								<p key={row.model}>
									{row.model}: {row.inputTokens ?? "unknown"} input tokens,{" "}
									{row.outputTokens ?? "unknown"} output tokens
									{!row.complete && " · incomplete"}
								</p>
							))}
							{naming.missing && (
								<p>Title naming was interrupted; usage and cost are unknown.</p>
							)}
							{naming.unknown && !naming.missing && (
								<p>
									Some naming token counts are unknown; total cost is
									unavailable.
								</p>
							)}
						</section>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
