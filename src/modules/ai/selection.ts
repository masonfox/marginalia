// The shape of a provider and model choice, shared by client and server.
import { z } from "zod";
import { AI_PROVIDERS } from "#/server/config";

/** Longest accepted model id. */
export const MAX_MODEL_ID_LENGTH = 200;

/**
 * A provider and a model id. The id need not appear in the provider's list;
 * whether the provider has credentials is checked on the server.
 */
export const selectionSchema = z.object({
	provider: z.enum(AI_PROVIDERS),
	model: z
		.string()
		.trim()
		.min(1, "Enter a model id.")
		.max(
			MAX_MODEL_ID_LENGTH,
			`A model id is at most ${MAX_MODEL_ID_LENGTH} characters.`,
		)
		.refine(
			(id) => ![...id].some((ch) => ch < " " || ch === "\u007f"),
			"A model id cannot contain control characters.",
		),
});
