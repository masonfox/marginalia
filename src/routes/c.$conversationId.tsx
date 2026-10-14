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
} from "#/components/chat";
import {
	DeleteConversation,
	RenameConversation,
} from "#/components/conversation-controls";
import { ResearchTrail } from "#/components/research-trail";
import { Button } from "#/components/ui/button";
import { getAiStatusFn, getConversationFn } from "#/fns/conversations";
import { groupParts } from "#/lib/research-trail";
import { exactUsage, replyUsageLine, totalUsageLine } from "#/lib/usage-format";
import type {
	CitationRecord,
	ConversationWithUsage,
} from "#/modules/conversation";

type Msg = UIMessage<ChatMeta, { citations: CitationRecord[] }>;
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
						body: { conversationId, message: textOf(messages.at(-1)) },
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

	const retry = () => {
		chat.clearError();
		if (last?.role === "user") {
			// The request never reached the server, so send the message again.
			const text = textOf(last);
			chat.setMessages(messages.slice(0, -1));
			void chat.sendMessage({ text });
		} else {
			void chat.regenerate();
		}
	};

	return (
		<main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col px-4 py-6">
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
							<p
								className="rounded-md border bg-muted/40 px-3 py-2 text-foreground"
								data-testid="spoiler-notice"
							>
								The assistant has access to the whole book, so it may reveal
								later events. Your messages and the passages it reads are sent
								to {ai.provider} ({ai.model}).
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
								{textOf(m)}
							</div>
						) : (
							<AssistantMessage
								message={m}
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
					className="sticky bottom-0 flex items-end gap-2 border-t bg-background pt-3"
					onSubmit={(e) => {
						e.preventDefault();
						const form = e.currentTarget;
						const value = new FormData(form).get("message");
						const text = typeof value === "string" ? value.trim() : "";
						if (!text || busy) return;
						form.reset();
						void chat.sendMessage({ text });
					}}
				>
					<textarea
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
						<Button type="submit">
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
	remainingBookIds,
	stopped,
	streaming,
	usage,
}: {
	message: Msg;
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
		<div className="space-y-2">
			{blocks.map((block) =>
				block.type === "text" ? (
					<AssistantText
						key={block.index}
						text={block.part.text}
						citations={citations}
						numbers={numbers}
						remainingBookIds={remainingBookIds}
					/>
				) : (
					<ResearchTrail
						key={block.index}
						parts={block.parts}
						hasReply={hasReply}
						streaming={streaming}
					/>
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
