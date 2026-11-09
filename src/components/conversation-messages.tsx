import type { UIMessage } from "ai";
import { type ReactNode, useMemo } from "react";
import {
	AssistantText,
	type ChatMeta,
	citationIndex,
	numberCitations,
	SourcesList,
	SourcesScope,
} from "#/components/chat";
import {
	type Attachment,
	attachmentOf,
	type ComposerState,
} from "#/components/composer/use-composer";
import { PassageQuote } from "#/components/passage-quote";
import { ReplyQuote } from "#/components/reply-selection";
import { ResearchTrail, type TrailContext } from "#/components/research-trail";
import { Button } from "#/components/ui/button";
import type { ChatSurface } from "#/components/use-chat-surface";
import {
	type PassageRef,
	passageContextOf,
	type StoredPassageContext,
} from "#/lib/passage-ref";
import type { StoredReplyContext } from "#/lib/reply-context";
import { groupParts, type Step } from "#/lib/research-trail";
import { exactUsage, replyUsageLine } from "#/lib/usage-format";
import type {
	CitationRecord,
	ConversationWithUsage,
	StoredMessage,
} from "#/modules/conversation";

/** A chat message as the conversation view shows it, in the main conversation or a thread. */
export type Msg = UIMessage<
	ChatMeta,
	{
		citations: CitationRecord[];
		"reply-context": StoredReplyContext;
		"passage-context": StoredPassageContext;
		/** Sent first, and transient, on every thread turn. */
		thread: { threadId: string };
	}
>;
export type ReplyUsage = ConversationWithUsage["usage"][string];

/** A stored message in the chat's shape. */
export function toMsg(m: StoredMessage): Msg {
	return {
		id: m.id,
		role: m.role,
		parts: m.parts as Msg["parts"],
		metadata: {
			citations: m.citations,
			finishReason: m.finishReason,
			error: m.error,
		},
	};
}

export const FINISH_NOTES: Record<string, string> = {
	aborted: "Stopped before finishing, so this reply is incomplete.",
	"tool-calls":
		"Stopped at the step limit before finishing, so this reply is incomplete.",
	length: "Cut off at the model's length limit, so this reply is incomplete.",
};

/**
 * A sent message's attachment. A quote of a reply inside a thread says so,
 * with a control that opens that thread.
 */
export function AttachmentPreview({
	attachment,
	threadOf,
	onOpenThread,
}: {
	attachment: Attachment | null;
	/** The thread holding a quoted reply, if it is in one. */
	threadOf?: (messageId: string) => string | undefined;
	onOpenThread?: (threadId: string) => void;
}) {
	if (attachment?.kind === "quote") {
		const threadId = threadOf?.(attachment.quote.messageId);
		return (
			<ReplyQuote
				quote={attachment.quote}
				onOpenThread={
					threadId && onOpenThread ? () => onOpenThread(threadId) : undefined
				}
			/>
		);
	}
	if (attachment?.kind === "passage")
		return <PassageQuote snapshot={attachment.snapshot} />;
	return null;
}

/** The reference a message's passage attachment was made from. */
export function refOf(parts: unknown[]): PassageRef | undefined {
	const passage = passageContextOf(parts);
	return passage
		? {
				locator: passage.locator,
				...(passage.range && { range: passage.range }),
			}
		: undefined;
}

export function textOf(message: Pick<Msg, "parts"> | undefined): string {
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

/** A failed generation: what went wrong, with Retry and, when possible, editing the message. */
export function FailureNotice({
	surface,
	composer,
}: {
	surface: ChatSurface;
	composer: ComposerState;
}) {
	return (
		<li
			role="alert"
			className="rounded-md border border-destructive-foreground/40 px-3 py-2 text-sm"
		>
			<p className="text-destructive-foreground">{surface.failureText}</p>
			{surface.recoveryError && <p>{surface.recoveryError}</p>}
			{surface.canEditFailed && (
				<Button type="button" onClick={() => void surface.editFailed(composer)}>
					Edit failed message
				</Button>
			)}
			<Button
				type="button"
				size="sm"
				variant="outline"
				className="mt-2"
				onClick={surface.retry}
			>
				Retry
			</Button>
		</li>
	);
}

/** A reader message: its attachment, then its text. */
export function UserMessage({
	message,
	threadOf,
	onOpenThread,
	children,
}: {
	message: Msg;
	threadOf?: (messageId: string) => string | undefined;
	onOpenThread?: (threadId: string) => void;
	children: ReactNode;
}) {
	return (
		<div className="ml-auto w-fit max-w-[90%] break-words rounded-[20px_20px_6px_20px] border bg-secondary px-5 py-4 text-[15.5px] leading-relaxed sm:max-w-[80%]">
			<AttachmentPreview
				attachment={attachmentOf(message.parts)}
				threadOf={threadOf}
				onOpenThread={onOpenThread}
			/>
			{children}
		</div>
	);
}

export function AssistantMessage({
	message,
	eligible,
	guideSteps,
	trailContext,
	remainingBookIds,
	stopped,
	streaming,
	usage,
	producedBy,
	children,
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
	/** Shown below the reply, such as its thread markers. */
	children?: ReactNode;
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
			<div className="space-y-2" data-message-id={message.id}>
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
						className="text-xs text-faint-foreground tabular-nums"
						title={usage && exactUsage(usage)}
						data-testid="reply-usage"
					>
						{model && <span data-testid="reply-model">{model}</span>}
						{model && usage && " · "}
						{usage && replyUsageLine(usage)}
						{usage && !usage.complete && " · partial"}
					</p>
				)}
				{children}
			</div>
		</SourcesScope>
	);
}
