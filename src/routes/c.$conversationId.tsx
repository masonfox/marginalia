import { useChat } from "@ai-sdk/react";
import {
	createFileRoute,
	Link,
	notFound,
	useRouter,
} from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Send, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
	AssistantText,
	type ChatMeta,
	citationIndex,
	numberCitations,
	SourcesList,
	SourcesScope,
} from "#/components/chat";
import {
	DeleteConversation,
	RenameConversation,
} from "#/components/conversation-controls";
import { ReplyQuote, ReplySelection } from "#/components/reply-selection";
import { ResearchTrail } from "#/components/research-trail";
import { ScopeNotice, scopeText, WidenScope } from "#/components/scope";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { getAiStatusFn, getConversationFn } from "#/fns/conversations";
import {
	type ReplyContext,
	replyContextOf,
	replyContextPart,
	type StoredReplyContext,
} from "#/lib/reply-context";
import { groupParts } from "#/lib/research-trail";
import { exactUsage, replyUsageLine, totalUsageLine } from "#/lib/usage-format";
import type {
	CitationRecord,
	ConversationWithUsage,
} from "#/modules/conversation";

type Msg = UIMessage<
	ChatMeta,
	{ citations: CitationRecord[]; "reply-context": StoredReplyContext }
>;
type ReplyUsage = ConversationWithUsage["usage"][string];

/** How many times to refetch while a finished reply's usage is not stored yet. */
const USAGE_REFETCHES = 5;

export const Route = createFileRoute("/c/$conversationId")({
	loader: async ({ params }) => {
		if (!z.uuid().safeParse(params.conversationId).success) throw notFound();
		const [conversation, ai] = await Promise.all([
			getConversationFn({ data: { conversationId: params.conversationId } }),
			getAiStatusFn(),
		]);
		if (!conversation) throw notFound();
		return { conversation, ai };
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
	const { conversation, ai } = Route.useLoaderData();
	const router = useRouter();
	const conversationId = conversation.id;

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

	const [draft, setDraft] = useState("");
	const [pendingQuote, setPendingQuote] = useState<ReplyContext | null>(null);
	const [recoveryError, setRecoveryError] = useState("");
	const submission = useRef<Msg | null>(null);
	const submissionBase = useRef(0);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset conversation-local state on navigation
	useEffect(() => {
		setDraft("");
		setPendingQuote(null);
		submission.current = null;
	}, [conversationId]);
	const bottom = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow new content
	useEffect(() => {
		bottom.current?.scrollIntoView({ block: "end" });
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
						JSON.stringify(replyContextOf(m.parts)) ===
							JSON.stringify(replyContextOf(snapshot.parts)),
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

	return (
		<main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col px-4 py-6">
			{ai.enabled && (
				<ReplySelection
					key={conversationId}
					onAttach={(quote) => {
						setPendingQuote(quote);
						inputRef.current?.focus();
					}}
				/>
			)}
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
					{ai.enabled && (
						<span data-testid="provider-label">
							{" "}
							· {ai.provider} · {ai.model}
						</span>
					)}
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
				<div className="mt-2 flex flex-wrap items-center gap-1">
					<RenameConversation
						conversationId={conversationId}
						title={conversation.title}
					/>
					<DeleteConversation
						conversationId={conversationId}
						title={conversation.title}
						onDeleted={() =>
							router.navigate({
								to: "/books/$editionId/conversations",
								params: { editionId: conversation.books[0]?.editionId ?? "" },
							})
						}
					/>
				</div>
			</header>

			<ol className="flex-1 space-y-5 py-6" aria-live="polite">
				{messages.length === 0 && (
					<li className="space-y-3 text-sm text-muted-foreground">
						{ai.enabled && (
							<p data-testid="provider-notice">
								Your messages and the passages the assistant reads are sent to{" "}
								{ai.provider} ({ai.model}).
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
							<div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2">
								{replyContextOf(m.parts) && (
									<ReplyQuote
										quote={replyContextOf(m.parts) as StoredReplyContext}
									/>
								)}
								{textOf(m)}
							</div>
						) : (
							<AssistantMessage
								message={m}
								eligible={
									ai.enabled &&
									savedAssistantIds.has(m.id) &&
									!(busy && m.id === last?.id)
								}
								remainingBookIds={remainingBookIds}
								stopped={m.id === stoppedId}
								streaming={busy && m.id === last?.id}
								usage={conversation.usage[m.id]}
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
									if (draft || pendingQuote) {
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
													JSON.stringify(replyContextOf(m.parts)) ===
														JSON.stringify(replyContextOf(snapshot.parts)),
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
										setDraft((current) => current || textOf(snapshot));
										setPendingQuote(
											(current) =>
												current ?? replyContextOf(snapshot.parts) ?? null,
										);
										inputRef.current?.focus();
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

			{ai.enabled ? (
				<form
					className="sticky bottom-0 flex flex-wrap items-end gap-2 border-t bg-background pt-3"
					onSubmit={(e) => {
						e.preventDefault();
						const text = draft.trim();
						if (!text || busy) return;
						const parts: Msg["parts"] = [
							...(pendingQuote ? [replyContextPart(pendingQuote)] : []),
							{ type: "text", text },
						];
						submissionBase.current = conversation.messages.length;
						submission.current = {
							id: crypto.randomUUID(),
							role: "user",
							parts,
						};
						setDraft("");
						setPendingQuote(null);
						void chat.sendMessage({ id: submission.current.id, parts });
					}}
				>
					{pendingQuote && (
						<div className="w-full">
							<ReplyQuote quote={pendingQuote} />
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setPendingQuote(null);
									inputRef.current?.focus();
								}}
							>
								Remove quote
							</Button>
						</div>
					)}
					<textarea
						ref={inputRef}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						name="message"
						rows={2}
						required
						maxLength={8000}
						aria-label="Message"
						placeholder="Say what you think…"
						className="min-h-12 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
					/>
					{busy ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setStoppedId(messages.at(-1)?.id ?? null);
								void chat.stop();
							}}
						>
							<Square aria-hidden /> Stop
						</Button>
					) : (
						<Button type="submit" disabled={!draft.trim()}>
							<Send aria-hidden /> Send
						</Button>
					)}
				</form>
			) : (
				<section
					className="rounded-md border bg-muted/40 p-4 text-sm"
					aria-labelledby="ai-off"
				>
					<h2 id="ai-off" className="font-medium">
						AI is not configured
					</h2>
					<p className="mt-1">
						Set <code>AI_PROVIDER</code>, <code>AI_MODEL</code>, and{" "}
						<code>AI_API_KEY</code> in the server's environment and restart to
						continue this conversation. Earlier messages stay available.
					</p>
				</section>
			)}
		</main>
	);
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
	remainingBookIds,
	stopped,
	streaming,
	usage,
}: {
	message: Msg;
	eligible: boolean;
	remainingBookIds: Set<string>;
	stopped: boolean;
	streaming: boolean;
	usage: ReplyUsage | undefined;
}) {
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
	return (
		<SourcesScope>
			<div className="space-y-2">
				{blocks.map((block) =>
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
								hasReply={hasReply}
								streaming={streaming}
							/>
						</div>
					),
				)}
				<SourcesList sources={sources} />
				{note && <p className="text-xs text-muted-foreground">{note}</p>}
				{usage && !streaming && (
					<p
						className="text-xs text-muted-foreground/70 tabular-nums"
						title={exactUsage(usage)}
						data-testid="reply-usage"
					>
						{replyUsageLine(usage)}
						{!usage.complete && " · partial"}
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
