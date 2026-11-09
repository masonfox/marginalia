import { randomUUID } from "node:crypto";
import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	stepCountIs,
	streamText,
	type UIMessage,
} from "ai";
import { and, eq, isNull } from "drizzle-orm";
import {
	type PassageRef,
	type PassageSnapshot,
	passageContextPart,
	projectPassageContext,
	type StoredPassageContext,
} from "#/lib/passage-ref";
import {
	projectReplyContext,
	REPLY_CONTEXT_LIMIT,
	type ReplyContext,
	replyContextPart,
	replyContextSchema,
	type StoredReplyContext,
} from "#/lib/reply-context";
import {
	type AiRuntime,
	describeError,
	type ResolvedModel,
} from "#/modules/ai";
import { createRetrieval } from "#/modules/retrieval";
import {
	checkSelection,
	getAiDefaults,
	getDiscussionPromptOverride,
	type SaveResult,
} from "#/modules/settings";
import { addUsage, NO_USAGE, recordUsage } from "#/modules/usage";
import type { AiSelection } from "#/server/config";
import type { Database } from "#/server/db";
import type { Enqueue } from "#/server/jobs/kinds";
import type { Logger } from "#/server/logger";
import { loadBookMaps } from "./guide-context";
import { checkPassageRef, type PassageRefInvalid } from "./passage-ref";
import {
	buildBookMapMessage,
	buildSystemPrompt,
	effectiveDiscussionText,
	effectivePromptIdentity,
} from "./prompt";
import {
	appendMessage,
	type ConversationDetail,
	createThreadWithMessage,
	getConversation,
	getMessages,
	getThread,
	type StoredMessage,
	type ThreadSummary,
	updateConversationModel,
} from "./repository";
import {
	type CitationRecord,
	type GuideContextEntry,
	type Json,
	messages,
} from "./schema";
import { projectThreadAnchor, type ThreadAnchor } from "./thread-context";
import { createConversationTools } from "./tools";
import { verifyCitations } from "./verify";

/** The UI message shape: text and tool parts plus a data part carrying verified citations. */
export type ChatUIMessage = UIMessage<
	unknown,
	{
		citations: CitationRecord[];
		"reply-context": StoredReplyContext;
		"passage-context": StoredPassageContext;
		/** Sent first, and transient, on every thread turn: the thread the reply belongs to (new or existing). */
		thread: { threadId: string };
	}
>;

/** Response header carrying the thread of a thread turn, for clients that read headers. */
export const THREAD_ID_HEADER = "x-marginalia-thread-id";

export interface ChatDeps {
	db: Database;
	enqueue?: Enqueue;
	ai: AiRuntime;
	log: Pick<Logger, "warn" | "error">;
}

export type ChatInput = {
	conversationId: string;
	/** The reader's new message. Omit to retry after a failed generation. */
	message?: string;
	replyContext?: ReplyContext;
	/** A passage the message refers to; never together with `replyContext`. */
	passageRef?: PassageRef;
	/** An existing side thread of the conversation to send (or retry) in. */
	threadId?: string;
	/**
	 * Starts a side thread with this message; never together with `threadId`,
	 * and never for a retry. Neither means the main conversation.
	 */
	newThread?: NewThreadAnchor;
	abortSignal?: AbortSignal;
};

/** Where a new thread is anchored: a main-conversation reply and the selected text. */
export interface NewThreadAnchor {
	anchorMessageId: string;
	quote: string;
}

export type ChatStart =
	| { status: "invalid_context" }
	/** `threadId` names no thread of the conversation, or the thread fields conflict. */
	| { status: "invalid_thread" }
	/** The new thread's anchor reply or quote is not acceptable. */
	| { status: "invalid_anchor" }
	| { status: "invalid_passage"; reason: PassageRefInvalid | "no_message" }
	| { status: "passage_out_of_scope"; unitLabel: string | null }
	| { status: "disabled" }
	| { status: "missing_model" }
	/** The model the turn would use has a provider without credentials. */
	| { status: "model_unavailable"; selection: AiSelection }
	| { status: "not_found" }
	| { status: "busy" }
	| { status: "nothing_to_retry" }
	| { status: "ok"; response: Response };

/** Conversations with a generation running. One process serves all requests, as with the login limiter. */
const inFlight = new Set<string>();

/**
 * Handles one chat turn: persists the user message, streams the model's reply
 * (with tool use), and persists the assistant message with verified
 * citations when the stream ends, is stopped, or fails.
 */
export async function startChat(
	deps: ChatDeps,
	input: ChatInput,
): Promise<ChatStart> {
	const { db, ai } = deps;
	if ((await ai.available()).length === 0) return { status: "disabled" };
	const conversation = await getConversation(db, input.conversationId);
	if (!conversation) return { status: "not_found" };
	// Resolved per turn, before anything is stored: the conversation's own
	// model, else the chat default now. Never falls back to another model.
	const selection =
		conversation.model ?? (await getAiDefaults(db, ai)).chat.selection;
	if (!selection) return { status: "missing_model" };
	const resolved = await ai.resolve(selection);
	if (!resolved.ok) return { status: "model_unavailable", selection };
	let branch: Branch = { kind: "main" };
	if (input.threadId !== undefined && input.newThread !== undefined)
		return { status: "invalid_thread" };
	if (input.threadId !== undefined) {
		const thread = await getThread(db, conversation.id, input.threadId);
		if (!thread) return { status: "invalid_thread" };
		branch = { kind: "thread", thread };
	} else if (input.newThread !== undefined) {
		// A new thread starts with a message; there is nothing in it to retry.
		if (!input.message?.trim()) return { status: "invalid_anchor" };
		const quote = input.newThread.quote.trim();
		const anchor = conversation.messages.find(
			(m) => m.id === input.newThread?.anchorMessageId,
		);
		// Checked again, under the conversation lock, when the thread is stored.
		if (
			!quote ||
			quote.length > REPLY_CONTEXT_LIMIT ||
			!anchor ||
			anchor.role !== "assistant" ||
			anchor.finishReason === "error"
		)
			return { status: "invalid_anchor" };
		branch = { kind: "new", anchorMessageId: anchor.id, quote };
	}
	if (input.replyContext && input.passageRef)
		return { status: "invalid_context" };
	// Re-checked here whatever the composer saw: the snapshot is replayed as book evidence.
	let passage: PassageSnapshot | undefined;
	if (input.passageRef) {
		if (!input.message?.trim())
			return { status: "invalid_passage", reason: "no_message" };
		const check = await checkPassageRef(db, conversation, input.passageRef);
		if (check.status === "invalid")
			return { status: "invalid_passage", reason: check.reason };
		if (check.status === "out_of_scope")
			return { status: "passage_out_of_scope", unitLabel: check.unitLabel };
		passage = check.snapshot;
	}
	if (inFlight.has(conversation.id)) return { status: "busy" };
	if (input.replyContext) {
		const context = replyContextSchema.safeParse(input.replyContext);
		if (
			!input.message?.trim() ||
			!context.success ||
			!(await isQuoteSource(
				db,
				conversation.id,
				context.data.messageId,
				branch,
			))
		)
			return { status: "invalid_context" };
		input = { ...input, replyContext: context.data };
	}
	inFlight.add(conversation.id);
	try {
		const prepared = await prepareHistory(db, conversation, input.message, {
			branch,
			replyContext: input.replyContext,
			passage,
			selection,
			onEnrolled: () => {
				const enqueue = deps.enqueue;
				if (enqueue)
					void Promise.resolve()
						.then(() =>
							enqueue("conversation.title", {
								conversationId: conversation.id,
							}),
						)
						.catch(() =>
							deps.log.warn(
								{ conversationId: conversation.id },
								"title enqueue failed; dispatcher will recover",
							),
						);
			},
		});
		if (prepared === "invalid_anchor" || prepared === null) {
			inFlight.delete(conversation.id);
			return {
				status: prepared === null ? "nothing_to_retry" : "invalid_anchor",
			};
		}
		const discussionPrompt = await getDiscussionPromptOverride(db);
		const response = generate(
			deps,
			resolved,
			conversation,
			prepared,
			discussionPrompt,
			input.abortSignal,
		);
		return { status: "ok", response };
	} catch (err) {
		inFlight.delete(conversation.id);
		throw err;
	}
}

export type SetModelResult =
	| SaveResult
	| { status: "not_found" }
	| { status: "busy" };

/**
 * Sets a conversation's own model, or clears it with null so it follows the
 * chat default. Applies from the next turn; refused while a reply is being
 * generated, so a running reply keeps the model it started with.
 */
export async function setConversationModel(
	deps: Pick<ChatDeps, "db" | "ai">,
	conversationId: string,
	input: unknown,
): Promise<SetModelResult> {
	let selection: AiSelection | null = null;
	if (input !== null) {
		const checked = await checkSelection(deps.ai, input);
		if (checked.status !== "ok") return checked;
		selection = checked.selection;
	}
	if (inFlight.has(conversationId)) return { status: "busy" };
	const updated = await updateConversationModel(
		deps.db,
		conversationId,
		selection,
	);
	return updated ? { status: "ok", selection } : { status: "not_found" };
}

/** Which part of the conversation a turn belongs to. */
type Branch =
	| { kind: "main" }
	| { kind: "thread"; thread: ThreadSummary }
	| { kind: "new"; anchorMessageId: string; quote: string };

/** A turn's model history, and the thread it is in. */
interface PreparedTurn {
	/** For a thread: the main conversation through the anchor reply, then the thread's messages. */
	history: StoredMessage[];
	thread: {
		id: string;
		anchor: ThreadAnchor;
		/** The thread's first reader message, which carries the anchor projection. */
		firstMessageId: string;
	} | null;
}

/**
 * Whether a quoted reply may be attached in this branch: any assistant reply
 * of the conversation in the main conversation (so thread text can be brought
 * to main), and only a reply of the same thread inside a thread.
 */
async function isQuoteSource(
	db: Database,
	conversationId: string,
	messageId: string,
	branch: Branch,
): Promise<boolean> {
	if (branch.kind === "new") return false;
	const [row] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(
			and(
				eq(messages.id, messageId),
				eq(messages.conversationId, conversationId),
				eq(messages.role, "assistant"),
				branch.kind === "thread"
					? eq(messages.threadId, branch.thread.id)
					: undefined,
			),
		);
	return !!row;
}

/**
 * Appends the new user message (or prepares a retry) and returns the messages
 * to send the model. Retries look only within the turn's own branch.
 */
async function prepareHistory(
	db: Database,
	conversation: ConversationDetail,
	text: string | undefined,
	{
		branch,
		replyContext,
		passage,
		selection,
		onEnrolled,
	}: {
		branch: Branch;
		replyContext?: ReplyContext;
		passage?: PassageSnapshot;
		selection?: AiSelection;
		onEnrolled?: () => void;
	},
): Promise<PreparedTurn | "invalid_anchor" | null> {
	const main = conversation.messages;
	let threadId: string | null = null;
	let anchor: ThreadAnchor | null = null;
	let stored: StoredMessage[];
	if (branch.kind === "main") stored = [...main];
	else if (branch.kind === "thread") {
		threadId = branch.thread.id;
		anchor = {
			messageId: branch.thread.anchorMessageId,
			quote: branch.thread.anchorQuote,
		};
		stored = await getMessages(db, conversation.id, { threadId });
	} else {
		anchor = { messageId: branch.anchorMessageId, quote: branch.quote };
		stored = [];
	}
	const finish = (): PreparedTurn | "invalid_anchor" => {
		if (!anchor) return { history: stored, thread: null };
		const anchorSeq = main.find((m) => m.id === anchor.messageId)?.seq;
		const first = stored[0];
		if (anchorSeq === undefined || !first || !threadId) return "invalid_anchor";
		return {
			history: [...main.filter((m) => m.seq <= anchorSeq), ...stored],
			thread: { id: threadId, anchor, firstMessageId: first.id },
		};
	};
	if (text === undefined) {
		if (branch.kind === "new") return null;
		const last = stored.at(-1);
		if (last?.role === "assistant" && last.finishReason === "error") {
			await db
				.delete(messages)
				.where(
					and(
						eq(messages.conversationId, conversation.id),
						eq(messages.id, last.id),
						threadId === null
							? isNull(messages.threadId)
							: eq(messages.threadId, threadId),
					),
				);
			stored.pop();
		}
		if (stored.at(-1)?.role !== "user") return null;
		return finish();
	}
	const parts: Json[] = [
		...(replyContext ? [replyContextPart(replyContext)] : []),
		...(passage ? [passageContextPart(passage)] : []),
		{ type: "text", text },
	];
	let saved: { id: string; seq: number; namingPending: boolean };
	if (branch.kind === "new") {
		const created = await createThreadWithMessage(db, {
			conversationId: conversation.id,
			anchorMessageId: branch.anchorMessageId,
			quote: branch.quote,
			message: { role: "user", parts, namingSelection: selection },
		});
		if (created.status !== "ok") return "invalid_anchor";
		threadId = created.threadId;
		saved = created;
	} else {
		saved = await appendMessage(db, {
			conversationId: conversation.id,
			threadId,
			role: "user",
			parts,
			namingSelection: selection,
		});
	}
	if (saved.namingPending) onEnrolled?.();
	stored.push({
		id: saved.id,
		threadId,
		seq: saved.seq,
		role: "user",
		parts,
		citations: [],
		finishReason: null,
		provider: null,
		model: null,
		promptVersion: null,
		error: null,
		guideContext: null,
		createdAt: new Date(),
	});
	return finish();
}

function generate(
	deps: ChatDeps,
	{ model, providerOptions, selection }: Extract<ResolvedModel, { ok: true }>,
	conversation: ConversationDetail,
	{ history, thread }: PreparedTurn,
	discussionPrompt: string | null,
	abortSignal: AbortSignal | undefined,
): Response {
	const { db, ai, log } = deps;
	const system = buildSystemPrompt(conversation.books, {
		maxSteps: ai.maxSteps,
		discussionPrompt,
	});
	const promptIdentity = effectivePromptIdentity(
		effectiveDiscussionText(conversation.books, discussionPrompt),
		discussionPrompt === null ? "default" : "custom",
	);
	const retrieval = createRetrieval(db);
	const verifyDeps = { retrieval, books: conversation.books };
	const tools = createConversationTools({
		db,
		retrieval,
		books: conversation.books,
	});
	const modelName = selection.model;
	// The reply's id from the start, so the client's message and the stored one match.
	const replyId = randomUUID();

	let failure: string | null = null;
	let citations: CitationRecord[] | null = null;
	let text = "";
	// Summed per completed step: totalUsage is unavailable after a stop.
	let usage = NO_USAGE;
	let steps = 0;
	// The maps this reply was sent, recorded on it for the research trail.
	let guideContext: GuideContextEntry[] | null = null;
	const warned = new Set<string>();

	const stream = createUIMessageStream<ChatUIMessage>({
		onError: describeError,
		execute: async ({ writer }) => {
			// First, so a client that sent a new thread learns its id before the reply.
			if (thread)
				writer.write({
					type: "data-thread",
					data: { threadId: thread.id },
					transient: true,
				});
			// Load once per turn; scope, stored summaries and the summary
			// corrections within scope alone determine the cached prefix.
			const bookMaps = await loadBookMaps(db, conversation.books);
			guideContext = bookMaps.guideContext;
			// Untrusted derived data goes in a message after the instructions, never in them.
			const map = buildBookMapMessage(conversation.books, bookMaps.maps);
			const result = streamText({
				model,
				system,
				messages: [
					...(map === null ? [] : [{ role: "user" as const, content: map }]),
					...(await convertToModelMessages(
						history.map((m) =>
							toUIMessage(
								m,
								thread && m.id === thread.firstMessageId
									? thread.anchor
									: undefined,
							),
						),
						{ tools },
					)),
				],
				tools,
				stopWhen: stepCountIs(ai.maxSteps),
				// The last step must answer. "none" keeps the tool definitions, so the cached prefix holds.
				prepareStep: ({ stepNumber }) =>
					stepNumber === ai.maxSteps - 1 ? { toolChoice: "none" } : undefined,
				temperature: ai.temperature,
				reasoning: ai.reasoning,
				providerOptions,
				abortSignal,
				onStepEnd: (step) => {
					usage = addUsage(usage, step.usage);
					steps += 1;
					for (const warning of step.warnings ?? []) {
						const key = JSON.stringify(warning);
						if (warned.has(key)) continue;
						warned.add(key);
						log.warn(
							{ warning, conversationId: conversation.id, model: modelName },
							"AI provider warning",
						);
					}
				},
				onError: () => {
					// Surfaced through the stream's error chunk below.
				},
			});
			for await (const chunk of result.toUIMessageStream({
				onError: describeError,
				generateMessageId: () => replyId,
			})) {
				if (chunk.type === "text-delta") text += chunk.delta;
				if (chunk.type === "error") failure = chunk.errorText;
				if (chunk.type === "finish" && !failure) {
					citations = await verifyCitations(verifyDeps, text);
					writer.write({ type: "data-citations", data: citations });
				}
				writer.write(chunk as never);
			}
		},
		onEnd: async ({
			responseMessage,
			isAborted,
			isCancelled,
			finishReason,
		}) => {
			try {
				const aborted = isAborted || isCancelled === true;
				const message = responseMessage as ChatUIMessage;
				const finalText = message.parts
					.filter((p) => p.type === "text")
					.map((p) => p.text)
					.join("");
				const verified =
					failure !== null
						? []
						: (citations ??
							(await verifyCitations(verifyDeps, finalText).catch(() => [])));
				const saved = await appendMessage(db, {
					id: replyId,
					conversationId: conversation.id,
					threadId: thread?.id ?? null,
					role: "assistant",
					parts: message.parts.filter(
						(p) => p.type !== "data-citations",
					) as Json[],
					citations: verified,
					finishReason: failure
						? "error"
						: aborted
							? "aborted"
							: (finishReason ?? "stop"),
					provider: selection.provider,
					model: modelName,
					promptVersion: promptIdentity,
					error: failure,
					guideContext,
				});
				try {
					await recordUsage(db, {
						...usage,
						purpose: "conversation",
						conversationId: conversation.id,
						messageId: saved.id,
						threadId: thread?.id ?? null,
						provider: selection.provider,
						model: modelName,
						steps,
						complete: !(aborted || failure !== null),
					});
				} catch (err) {
					// The reply is saved; only its cost goes unrecorded.
					log.error(
						{ err, conversationId: conversation.id },
						"could not record usage",
					);
				}
			} catch (err) {
				log.error(
					{ err, conversationId: conversation.id },
					"could not save reply",
				);
			} finally {
				inFlight.delete(conversation.id);
			}
		},
	});
	return createUIMessageStreamResponse({
		stream,
		headers: thread ? { [THREAD_ID_HEADER]: thread.id } : undefined,
	});
}

function toUIMessage(
	m: StoredMessage,
	anchor?: ThreadAnchor,
): Omit<ChatUIMessage, "id"> {
	return {
		role: m.role,
		parts: replayableParts(
			m.role !== "user"
				? m.parts
				: anchor
					? projectThreadAnchor(m.parts, anchor)
					: projectReplyContext(projectPassageContext(m.parts)),
		),
	};
}

/** Parts that can be replayed to a model: text and finished tool calls. */
function replayableParts(parts: unknown[]): ChatUIMessage["parts"] {
	return (parts as { type: string; state?: string }[]).filter((p) => {
		if (p.type === "text" || p.type === "step-start") return true;
		const isTool = p.type.startsWith("tool-") || p.type === "dynamic-tool";
		return (
			isTool && (p.state === "output-available" || p.state === "output-error")
		);
	}) as ChatUIMessage["parts"];
}

/** A reader-safe message for a stream error. Never includes credentials. */
export { describeError };
