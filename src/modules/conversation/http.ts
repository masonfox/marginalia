import { z } from "zod";
import { passageRefSchema } from "#/lib/passage-ref";
import { REPLY_CONTEXT_LIMIT, replyContextSchema } from "#/lib/reply-context";
import { type ChatDeps, startChat } from "./chat";

const chatBody = z
	.object({
		conversationId: z.uuid(),
		/** The new user message, stored as typed. Omit to retry after a failed generation. */
		message: z
			.string()
			.max(8000)
			.refine((s) => s.trim().length > 0)
			.optional(),
		replyContext: replyContextSchema.optional(),
		passageRef: passageRefSchema.optional(),
		/** Send (or retry) in this existing side thread. */
		threadId: z.uuid().optional(),
		/** Start a side thread with this message, anchored to selected reply text. */
		newThread: z
			.object({
				anchorMessageId: z.uuid(),
				quote: z.string().trim().min(1).max(REPLY_CONTEXT_LIMIT),
			})
			.optional(),
	})
	// One attachment at most, and only with a new message.
	.refine((body) => !(body.replyContext && body.passageRef))
	.refine(
		(body) =>
			!(body.replyContext || body.passageRef) || body.message !== undefined,
	)
	// An existing thread or a new one, never both; a new thread needs its first message.
	.refine((body) => !(body.threadId && body.newThread))
	.refine((body) => !body.newThread || body.message !== undefined);

const json = (status: number, error: string) =>
	Response.json({ error }, { status });

/**
 * `POST /api/chat`: the access guard and origin check run before this (in the
 * server entry), so an unauthenticated request never reaches it.
 */
export async function handleChatRequest(
	request: Request,
	deps: ChatDeps,
): Promise<Response> {
	const body = chatBody.safeParse(await request.json().catch(() => null));
	if (!body.success) return json(400, "Invalid chat request");
	const result = await startChat(deps, {
		conversationId: body.data.conversationId,
		message: body.data.message,
		replyContext: body.data.replyContext,
		passageRef: body.data.passageRef,
		threadId: body.data.threadId,
		newThread: body.data.newThread,
		abortSignal: request.signal,
	});
	switch (result.status) {
		case "ok":
			return result.response;
		case "disabled":
			return json(503, "AI is not configured on this instance");
		case "missing_model":
			return json(
				503,
				"Choose a chat model in Settings before starting a chat.",
			);
		case "model_unavailable":
			return Response.json(
				{
					error: `Model ${result.selection.provider}/${result.selection.model} is unavailable`,
					selection: result.selection,
				},
				{ status: 503 },
			);
		case "not_found":
			return json(404, "Conversation not found");
		case "busy":
			return json(409, "A reply is already being generated");
		case "invalid_context":
			return json(400, "Invalid assistant-response context");
		case "invalid_thread":
			return json(400, "Invalid thread");
		case "invalid_anchor":
			return json(400, "Invalid thread anchor");
		case "invalid_passage":
			return Response.json(
				{ error: "Invalid passage reference", reason: result.reason },
				{ status: 400 },
			);
		case "passage_out_of_scope":
			return Response.json(
				{
					error: "The passage is beyond this conversation's scope",
					unitLabel: result.unitLabel,
				},
				{ status: 409 },
			);
		case "nothing_to_retry":
			return json(409, "There is no failed reply to retry");
	}
}
