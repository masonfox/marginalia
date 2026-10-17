import { randomUUID } from "node:crypto";
import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	stepCountIs,
	streamText,
	type UIMessage,
} from "ai";
import { and, eq } from "drizzle-orm";
import {
	type PassageRef,
	type PassageSnapshot,
	passageContextPart,
	projectPassageContext,
	type StoredPassageContext,
} from "#/lib/passage-ref";
import {
	projectReplyContext,
	type ReplyContext,
	replyContextPart,
	replyContextSchema,
	type StoredReplyContext,
} from "#/lib/reply-context";
import { type AiRuntime, describeError } from "#/modules/ai";
import { createRetrieval } from "#/modules/retrieval";
import { addUsage, NO_USAGE, recordUsage } from "#/modules/usage";
import type { Database } from "#/server/db";
import type { Logger } from "#/server/logger";
import { loadBookMaps } from "./guide-context";
import { checkPassageRef, type PassageRefInvalid } from "./passage-ref";
import {
	buildBookMapMessage,
	buildSystemPrompt,
	PROMPT_VERSION,
} from "./prompt";
import {
	appendMessage,
	type ConversationDetail,
	getConversation,
	type StoredMessage,
	setProvisionalTitle,
} from "./repository";
import {
	type CitationRecord,
	type GuideContextEntry,
	type Json,
	messages,
} from "./schema";
import { createConversationTools } from "./tools";
import { verifyCitations } from "./verify";

/** The UI message shape: text and tool parts plus a data part carrying verified citations. */
export type ChatUIMessage = UIMessage<
	unknown,
	{
		citations: CitationRecord[];
		"reply-context": StoredReplyContext;
		"passage-context": StoredPassageContext;
	}
>;

export interface ChatDeps {
	db: Database;
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
	abortSignal?: AbortSignal;
};

export type ChatStart =
	| { status: "invalid_context" }
	| { status: "invalid_passage"; reason: PassageRefInvalid | "no_message" }
	| { status: "passage_out_of_scope"; unitLabel: string | null }
	| { status: "disabled" }
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
	if (!ai.model) return { status: "disabled" };
	const conversation = await getConversation(db, input.conversationId);
	if (!conversation) return { status: "not_found" };
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
			!conversation.messages.some(
				(m) => m.id === context.data.messageId && m.role === "assistant",
			)
		)
			return { status: "invalid_context" };
		input = { ...input, replyContext: context.data };
	}
	inFlight.add(conversation.id);
	try {
		const history = await prepareHistory(db, conversation, input.message, {
			replyContext: input.replyContext,
			passage,
		});
		if (!history) {
			inFlight.delete(conversation.id);
			return { status: "nothing_to_retry" };
		}
		const response = generate(deps, conversation, history, input.abortSignal);
		return { status: "ok", response };
	} catch (err) {
		inFlight.delete(conversation.id);
		throw err;
	}
}

/** Appends the new user message (or prepares a retry) and returns the messages to send the model. */
async function prepareHistory(
	db: Database,
	conversation: ConversationDetail,
	text: string | undefined,
	{
		replyContext,
		passage,
	}: { replyContext?: ReplyContext; passage?: PassageSnapshot } = {},
): Promise<StoredMessage[] | null> {
	const stored = [...conversation.messages];
	if (text === undefined) {
		const last = stored.at(-1);
		if (last?.role === "assistant" && last.finishReason === "error") {
			await db
				.delete(messages)
				.where(
					and(
						eq(messages.conversationId, conversation.id),
						eq(messages.id, last.id),
					),
				);
			stored.pop();
		}
		return stored.at(-1)?.role === "user" ? stored : null;
	}
	const parts: Json[] = [
		...(replyContext ? [replyContextPart(replyContext)] : []),
		...(passage ? [passageContextPart(passage)] : []),
		{ type: "text", text },
	];
	const saved = await appendMessage(db, {
		conversationId: conversation.id,
		role: "user",
		parts,
	});
	if (stored.length === 0) await setProvisionalTitle(db, conversation.id, text);
	stored.push({
		id: saved.id,
		seq: saved.seq,
		role: "user",
		parts,
		citations: [],
		finishReason: null,
		model: null,
		promptVersion: null,
		error: null,
		guideContext: null,
		createdAt: new Date(),
	});
	return stored;
}

function generate(
	deps: ChatDeps,
	conversation: ConversationDetail,
	history: StoredMessage[],
	abortSignal: AbortSignal | undefined,
): Response {
	const { db, ai, log } = deps;
	const retrieval = createRetrieval(db);
	const verifyDeps = { retrieval, books: conversation.books };
	const tools = createConversationTools({
		db,
		retrieval,
		books: conversation.books,
	});
	const modelName = ai.status.model ?? null;
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
			// Load once per turn; scope, stored summaries and the summary
			// corrections within scope alone determine the cached prefix.
			const bookMaps = await loadBookMaps(db, conversation.books);
			guideContext = bookMaps.guideContext;
			// Untrusted derived data goes in a message after the instructions, never in them.
			const map = buildBookMapMessage(conversation.books, bookMaps.maps);
			const result = streamText({
				// `model` is non-null: startChat checked.
				model: ai.model as NonNullable<AiRuntime["model"]>,
				system: buildSystemPrompt(conversation.books, {
					maxSteps: ai.maxSteps,
				}),
				messages: [
					...(map === null ? [] : [{ role: "user" as const, content: map }]),
					...(await convertToModelMessages(history.map(toUIMessage), {
						tools,
					})),
				],
				tools,
				stopWhen: stepCountIs(ai.maxSteps),
				// The last step must answer. "none" keeps the tool definitions, so the cached prefix holds.
				prepareStep: ({ stepNumber }) =>
					stepNumber === ai.maxSteps - 1 ? { toolChoice: "none" } : undefined,
				temperature: ai.temperature,
				reasoning: ai.reasoning,
				providerOptions: ai.providerOptions,
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
					model: modelName,
					promptVersion: PROMPT_VERSION,
					error: failure,
					guideContext,
				});
				try {
					await recordUsage(db, {
						...usage,
						purpose: "conversation",
						conversationId: conversation.id,
						messageId: saved.id,
						provider: ai.status.provider ?? "unknown",
						model: modelName ?? "unknown",
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
	return createUIMessageStreamResponse({ stream });
}

function toUIMessage(m: StoredMessage): Omit<ChatUIMessage, "id"> {
	return {
		role: m.role,
		parts: replayableParts(
			m.role === "user"
				? projectReplyContext(projectPassageContext(m.parts))
				: m.parts,
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
