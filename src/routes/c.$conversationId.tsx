import { useChat } from "@ai-sdk/react";
import {
	createFileRoute,
	Link,
	notFound,
	useRouter,
} from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
	AiSetupNotice,
	AssistantText,
	type ChatMeta,
	citationIndex,
	modelInEffect,
	numberCitations,
	SourcesList,
	SourcesScope,
	UserMarkdown,
} from "#/components/chat";
import { Composer } from "#/components/composer/composer";
import {
	type Attachment,
	attachmentOf,
	useComposer,
} from "#/components/composer/use-composer";
import {
	ConversationModelControl,
	DeleteConversation,
	PositionOfferProvider,
	PositionUpdateOffer,
	RenameConversation,
	useConversationModel,
} from "#/components/conversation-controls";
import { replyModelLabel, selectionLabel } from "#/components/model-picker";
import { PassageQuote } from "#/components/passage-quote";
import {
	ReplyQuote,
	ReplySelection,
	SaveNoteBookDialog,
} from "#/components/reply-selection";
import { ResearchTrail, type TrailContext } from "#/components/research-trail";
import { ScopeNotice, scopeText, WidenScope } from "#/components/scope";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { getAiStatusFn, getConversationFn } from "#/fns/conversations";
import { excerptNoteDraft } from "#/lib/note-prefill";
import {
	attachmentKey,
	type PassageRef,
	passageContextOf,
	passageContextPart,
	type StoredPassageContext,
} from "#/lib/passage-ref";
import {
	type ReplyContext,
	replyContextOf,
	replyContextPart,
	type StoredReplyContext,
} from "#/lib/reply-context";
import { groupParts, guideSteps, type Step } from "#/lib/research-trail";
import { exactUsage, replyUsageLine, totalUsageLine } from "#/lib/usage-format";
import type {
	CitationRecord,
	ConversationWithUsage,
} from "#/modules/conversation";

type Msg = UIMessage<
	ChatMeta,
	{
		citations: CitationRecord[];
		"reply-context": StoredReplyContext;
		"passage-context": StoredPassageContext;
	}
>;
type ReplyUsage = ConversationWithUsage["usage"][string];

/** How many times to refetch while a finished reply's usage is not stored yet. */
const USAGE_REFETCHES = 5;

export const Route = createFileRoute("/c/$conversationId")({
	// A passage reference handed over from the passage view; removed once attached.
	validateSearch: z.object({
		ref: z.string().max(100).optional(),
		hl: z.string().max(20).optional(),
	}),
	loader: async ({ params }) => {
		if (!z.uuid().safeParse(params.conversationId).success) throw notFound();
		const [conversation, status] = await Promise.all([
			getConversationFn({ data: { conversationId: params.conversationId } }),
			getAiStatusFn(),
		]);
		if (!conversation) throw notFound();
		return { conversation, status };
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

const FINISH_NOTES: Record<string, string> = {
	aborted: "Stopped before finishing, so this reply is incomplete.",
	"tool-calls":
		"Stopped at the step limit before finishing, so this reply is incomplete.",
	length: "Cut off at the model's length limit, so this reply is incomplete.",
};

function ConversationPage() {
	const { conversation, status: aiStatus } = Route.useLoaderData();
	const router = useRouter();
	const conversationId = conversation.id;
	// The model the next reply uses; without one, guidance replaces the composer.
	const effect = modelInEffect(aiStatus, conversation.model);
	const aiEnabled = effect.status === "ok";
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const conversationModel = useConversationModel(conversationId);

	const initial = useMemo<Msg[]>(
		() =>
			conversation.messages.map((m) => ({
				id: m.id,
				role: m.role,
				parts: m.parts as Msg["parts"],
				metadata: {
					citations: m.citations,
					finishReason: m.finishReason,
					error: m.error,
				},
			})),
		// Only the first render seeds the chat; later updates come from the stream.
		[conversation.messages],
	);
	const transport = useMemo(
		() =>
			new DefaultChatTransport<Msg>({
				api: "/api/chat",
				prepareSendMessagesRequest: ({ messages, trigger }) => {
					// The server owns the history: send only the new message, or nothing to retry.
					if (trigger === "regenerate-message") {
						return { body: { conversationId } };
					}
					return {
						body: {
							conversationId,
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
	const chat = useChat<Msg>({
		id: conversationId,
		messages: initial,
		transport,
		// Runs after a finish, a stop, and an error alike.
		onFinish: ({ message }) => {
			setAwaitingUsage({ id: message.id, tries: 0 });
			void router.invalidate();
		},
	});
	useEffect(() => {
		if (!awaitingUsage) return;
		if (
			conversation.usage[awaitingUsage.id] ||
			awaitingUsage.tries >= USAGE_REFETCHES
		) {
			setAwaitingUsage(null);
			return;
		}
		const timer = setTimeout(() => {
			setAwaitingUsage({ ...awaitingUsage, tries: awaitingUsage.tries + 1 });
			void router.invalidate();
		}, 600);
		return () => clearTimeout(timer);
	}, [awaitingUsage, conversation.usage, router]);
	const { messages, status, error } = chat;
	const busy = status === "submitted" || status === "streaming";
	// The reply the reader stopped, so it can be marked incomplete before it is reloaded.
	const [stoppedId, setStoppedId] = useState<string | null>(null);
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

	const [recoveryError, setRecoveryError] = useState("");
	const submission = useRef<Msg | null>(null);
	const submissionBase = useRef(0);
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const composer = useComposer(conversationId, {
		savedAssistantIds,
		books: conversation.books,
		aiEnabled,
		handoff: search,
		clearHandoff: () => void navigate({ search: {}, replace: true }),
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new conversation has no submission
	useEffect(() => {
		submission.current = null;
	}, [conversationId]);
	const bottom = useRef<HTMLDivElement>(null);
	const dock = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow new content
	useEffect(() => {
		const anchor = bottom.current;
		if (!anchor) return;
		// Stop above the composer, which floats over the end of the list.
		anchor.style.scrollMarginBottom = `${dock.current?.offsetHeight ?? 0}px`;
		anchor.scrollIntoView({ block: "end" });
	}, [messages, status]);

	const last = messages.at(-1);
	const lastStoredError =
		last?.role === "assistant" && last.metadata?.finishReason === "error";
	const failed = status === "error" || lastStoredError;
	const failureText =
		error?.message ??
		(lastStoredError ? last?.metadata?.error : null) ??
		"Something went wrong.";

	const retry = async () => {
		setRecoveryError("");
		try {
			const saved = await getConversationFn({ data: { conversationId } });
			if (!saved) throw new Error("Could not reload conversation. Try again.");
			const snapshot =
				submission.current ??
				[...messages].reverse().find((m) => m.role === "user");
			const base = snapshot ? submissionBase.current - 1 : -1;
			const accepted =
				snapshot &&
				saved.messages.some(
					(m, i) =>
						i > base &&
						m.role === "user" &&
						textOf({ ...m, parts: m.parts as Msg["parts"] } as Msg) ===
							textOf(snapshot) &&
						attachmentKey(m.parts) === attachmentKey(snapshot.parts),
				);
			chat.clearError();
			if (accepted || (!submission.current && last?.role === "assistant")) {
				chat.setMessages(
					saved.messages.map((m) => ({
						id: m.id,
						role: m.role,
						parts: m.parts as Msg["parts"],
						metadata: {
							citations: m.citations,
							finishReason: m.finishReason,
							error: m.error,
						},
					})),
				);
				const tail = saved.messages.at(-1);
				if (tail?.role === "assistant" && tail.finishReason !== "error") {
					submission.current = null;
					await router.invalidate();
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
			<main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col px-4 py-6">
				<ReplySelection
					key={conversationId}
					onAttach={aiEnabled ? composer.attachQuote : undefined}
					onTooLong={composer.rejectLongQuote}
					onSaveAsNote={conversation.books.length > 0 ? saveAsNote : undefined}
				/>
				<SaveNoteBookDialog
					books={noteExcerpt === null ? null : conversation.books}
					onChoose={(editionId) => {
						if (noteExcerpt) openNoteDraft(noteExcerpt, editionId);
						setNoteExcerpt(null);
					}}
					onCancel={() => setNoteExcerpt(null)}
				/>
				<header className="border-b pb-4">
					<p className="text-sm">
						<Link
							to="/books/$editionId/conversations"
							params={{ editionId: conversation.books[0]?.editionId ?? "" }}
							className="text-muted-foreground hover:underline"
						>
							← Conversations
						</Link>
					</p>
					<h1 className="mt-2 font-serif text-2xl font-semibold">
						{conversation.title}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{conversation.books.length === 0
							? "No book"
							: conversation.books.map((b, i) => (
									<span key={b.editionId}>
										{i > 0 && ", "}
										<Link
											to="/books/$editionId"
											params={{ editionId: b.editionId }}
											className="hover:underline"
										>
											{b.title}
										</Link>
									</span>
								))}
						<ConversationModelControl
							conversationId={conversationId}
							status={aiStatus}
							own={conversation.model}
							effect={effect}
							disabled={busy}
							open={modelPickerOpen}
							onOpenChange={setModelPickerOpen}
						/>
						<UsageTotal total={conversation.usageTotal} />
					</p>
					{conversation.books.length > 0 && (
						<ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
							{conversation.books.map((b) => (
								<li key={b.editionId} className="flex items-center gap-1">
									<Badge variant="secondary" data-testid="scope-chip">
										{conversation.books.length > 1 && `${b.title}: `}
										{scopeText(b.scopeLabel)}
									</Badge>
									<WidenScope
										conversationId={conversationId}
										book={b}
										disabled={busy}
									/>
								</li>
							))}
						</ul>
					)}
					<div className="mt-3">
						<ScopeNotice labels={conversation.books.map((b) => b.scopeLabel)} />
					</div>
					<PositionUpdateOffer />
					<div className="mt-2 flex flex-wrap items-center gap-1">
						<RenameConversation
							conversationId={conversationId}
							title={conversation.title}
						/>
						<DeleteConversation
							conversationId={conversationId}
							title={conversation.title}
							onDeleted={() => {
								composer.clear();
								return router.navigate({
									to: "/books/$editionId/conversations",
									params: { editionId: conversation.books[0]?.editionId ?? "" },
								});
							}}
						/>
					</div>
				</header>

				<ol className="flex-1 space-y-5 py-6" aria-live="polite">
					{messages.length === 0 && (
						<li className="space-y-3 text-sm text-muted-foreground">
							{effect.status === "ok" && (
								<p data-testid="provider-notice">
									Your messages and the passages the assistant reads are sent to{" "}
									{selectionLabel(effect.selection)}.
								</p>
							)}
							<p>
								Ask about a scene, a character, or a theory you are forming. The
								assistant will search the book and push back where the text does
								not support you.
							</p>
						</li>
					)}
					{messages.map((m) => (
						<li key={m.id}>
							{m.role === "user" ? (
								<div className="ml-auto w-fit max-w-[85%] break-words rounded-lg bg-secondary px-3 py-2">
									<AttachmentPreview attachment={attachmentOf(m.parts)} />
									<UserMarkdown text={textOf(m)} />
								</div>
							) : (
								<AssistantMessage
									message={m}
									eligible={
										savedAssistantIds.has(m.id) && !(busy && m.id === last?.id)
									}
									guideSteps={guideSteps(
										guideContexts.get(m.id),
										conversation.books,
									)}
									trailContext={trailContext}
									remainingBookIds={remainingBookIds}
									stopped={m.id === stoppedId}
									streaming={busy && m.id === last?.id}
									usage={conversation.usage[m.id]}
									producedBy={producers.get(m.id) ?? null}
								/>
							)}
						</li>
					))}
					{status === "submitted" && (
						<li className="text-sm text-muted-foreground">Thinking…</li>
					)}
					{failed && (
						<li
							role="alert"
							className="rounded-md border border-destructive-foreground/40 px-3 py-2 text-sm"
						>
							<p className="text-destructive-foreground">{failureText}</p>
							{recoveryError && <p>{recoveryError}</p>}
							{submission.current && (
								<Button
									type="button"
									onClick={async () => {
										if (composer.draft || composer.attachment) {
											setRecoveryError(
												"Your newer draft is preserved. Clear it before editing the failed message.",
											);
											return;
										}
										try {
											const snapshot = submission.current;
											const saved = await getConversationFn({
												data: { conversationId },
											});
											if (!saved || !snapshot)
												throw new Error(
													"Could not reload the submitted message.",
												);
											if (
												saved.messages.slice(submissionBase.current).some(
													(m) =>
														m.role === "user" &&
														textOf({
															...m,
															parts: m.parts as Msg["parts"],
														} as Msg) === textOf(snapshot) &&
														attachmentKey(m.parts) ===
															attachmentKey(snapshot.parts),
												)
											) {
												setRecoveryError(
													"This message is already saved. Use Retry to continue its reply.",
												);
												return;
											}
											chat.setMessages(
												messages.filter((m) => m.id !== snapshot.id),
											);
											chat.clearError();
											composer.restore(
												textOf(snapshot),
												attachmentOf(snapshot.parts),
											);
										} catch (err) {
											setRecoveryError(
												err instanceof Error
													? err.message
													: "Could not recover the message.",
											);
										}
									}}
								>
									Edit failed message
								</Button>
							)}
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="mt-2"
								onClick={retry}
							>
								Retry
							</Button>
						</li>
					)}
					<div ref={bottom} />
				</ol>

				{effect.status === "ok" ? (
					// The page background below the card and a fade above it, so messages
					// scroll under the composer. Only the card itself takes the pointer.
					<div
						ref={dock}
						className="pointer-events-none sticky bottom-0 z-10 -mx-2 bg-gradient-to-t from-background from-75% to-transparent px-2 pt-8 pb-3 *:pointer-events-auto"
					>
						<Composer
							composer={composer}
							conversationId={conversationId}
							books={conversation.books}
							busy={busy}
							onStop={() => {
								setStoppedId(messages.at(-1)?.id ?? null);
								void chat.stop();
							}}
							onSend={() => {
								const text = composer.draft;
								const attachment = composer.attachment;
								const parts: Msg["parts"] = [
									...(attachment?.kind === "quote"
										? [replyContextPart(attachment.quote)]
										: []),
									...(attachment?.kind === "passage"
										? [passageContextPart(attachment.snapshot)]
										: []),
									{ type: "text", text },
								];
								submissionBase.current = conversation.messages.length;
								submission.current = {
									id: crypto.randomUUID(),
									role: "user",
									parts,
								};
								composer.clear();
								void chat.sendMessage({ id: submission.current.id, parts });
							}}
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
											disabled={busy}
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
											disabled={busy || conversationModel.busy}
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
		</PositionOfferProvider>
	);
}

function AttachmentPreview({ attachment }: { attachment: Attachment | null }) {
	if (attachment?.kind === "quote")
		return <ReplyQuote quote={attachment.quote} />;
	if (attachment?.kind === "passage")
		return <PassageQuote snapshot={attachment.snapshot} />;
	return null;
}

/** The reference a message's passage attachment was made from. */
function refOf(parts: unknown[]): PassageRef | undefined {
	const passage = passageContextOf(parts);
	return passage
		? {
				locator: passage.locator,
				...(passage.range && { range: passage.range }),
			}
		: undefined;
}

function textOf(message: Msg | undefined): string {
	return (message?.parts ?? [])
		.map((p) => (p.type === "text" ? p.text : ""))
		.join("");
}

function citationsOf(message: Msg): CitationRecord[] {
	const stored = message.metadata?.citations;
	if (stored && stored.length > 0) return stored;
	for (const part of message.parts) {
		if (part.type === "data-citations") return part.data;
	}
	return [];
}

function AssistantMessage({
	message,
	eligible,
	guideSteps,
	trailContext,
	remainingBookIds,
	stopped,
	streaming,
	usage,
	producedBy,
}: {
	message: Msg;
	/** Whether the reader can select from the reply to quote or save it. */
	eligible: boolean;
	/** The guide steps its trail starts with; none for older replies. */
	guideSteps: Step[];
	trailContext: TrailContext;
	remainingBookIds: Set<string>;
	stopped: boolean;
	streaming: boolean;
	usage: ReplyUsage | undefined;
	/** The stored reply's provider and model; null for a reply not reloaded yet. */
	producedBy: string | null;
}) {
	const model = producedBy ?? usage?.model ?? null;
	const citations = useMemo(
		() => citationIndex(citationsOf(message)),
		[message],
	);
	const { numbers, sources } = useMemo(
		() =>
			numberCitations(
				message.parts.map((part) => (part.type === "text" ? part.text : "")),
				citations,
				remainingBookIds,
			),
		[message, citations, remainingBookIds],
	);
	const note = stopped
		? FINISH_NOTES.aborted
		: message.metadata?.finishReason
			? FINISH_NOTES[message.metadata.finishReason]
			: undefined;
	const blocks = groupParts(message.parts);
	const hasReply = blocks.some((b) => b.type === "text");
	// The guide steps start the reply's trail: the first run of tool calls, or one of their own.
	const ownGuideTrail = guideSteps.length > 0 && blocks[0]?.type !== "trail";
	return (
		<SourcesScope>
			<div className="space-y-2">
				{ownGuideTrail && (
					<div data-reply-excluded>
						<ResearchTrail
							parts={[]}
							leading={guideSteps}
							context={trailContext}
							hasReply={hasReply}
							streaming={streaming}
						/>
					</div>
				)}
				{blocks.map((block, i) =>
					block.type === "text" ? (
						<AssistantText
							sourceMessageId={eligible ? message.id : undefined}
							key={block.index}
							text={block.part.text}
							citations={citations}
							numbers={numbers}
							remainingBookIds={remainingBookIds}
						/>
					) : (
						<div key={block.index} data-reply-excluded>
							<ResearchTrail
								parts={block.parts}
								leading={i === 0 ? guideSteps : []}
								context={trailContext}
								hasReply={hasReply}
								streaming={streaming}
							/>
						</div>
					),
				)}
				<SourcesList sources={sources} />
				{note && <p className="text-xs text-muted-foreground">{note}</p>}
				{(usage || model) && !streaming && (
					<p
						className="text-xs text-muted-foreground/70 tabular-nums"
						title={usage && exactUsage(usage)}
						data-testid="reply-usage"
					>
						{model && <span data-testid="reply-model">{model}</span>}
						{model && usage && " · "}
						{usage && replyUsageLine(usage)}
						{usage && !usage.complete && " · partial"}
					</p>
				)}
			</div>
		</SourcesScope>
	);
}

/** The running total in the header. Costs are estimates; replies without usage are counted out loud. */
function UsageTotal({ total }: { total: ConversationWithUsage["usageTotal"] }) {
	const hasUsage = total.inputTokens !== null || total.outputTokens !== null;
	if (!hasUsage && total.missing === 0) return null;
	const missing =
		total.missing > 0
			? `${total.missing} ${total.missing === 1 ? "reply has" : "replies have"} no recorded usage`
			: null;
	return (
		<span
			className="tabular-nums"
			title={hasUsage ? exactUsage(total) : undefined}
			data-testid="usage-total"
		>
			{hasUsage && <> · {totalUsageLine(total)}</>}
			{missing && <> · {missing}</>}
		</span>
	);
}
