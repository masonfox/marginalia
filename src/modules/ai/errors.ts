import { APICallError } from "ai";

/** Longest reader-visible error message. */
export const MAX_ERROR_LENGTH = 500;

/** A reader-safe message for an AI call error. Never includes credentials. */
export function describeError(error: unknown): string {
	if (APICallError.isInstance(error)) {
		const status = error.statusCode ? ` (HTTP ${error.statusCode})` : "";
		const hint =
			error.statusCode === 401 || error.statusCode === 403
				? " Check AI_API_KEY and that the key may use this model."
				: "";
		return redactSecrets(
			`The AI provider returned an error${status}: ${error.message}.${hint}`,
		);
	}
	if (error instanceof Error) return redactSecrets(error.message);
	return "The AI provider failed.";
}

/** Truncates and masks anything shaped like an API key, in case a provider echoes one. */
export function redactSecrets(message: string): string {
	return message
		.replace(/(?<![A-Za-z0-9])(sk|key|AIza)[-_A-Za-z0-9]{12,}/g, "[redacted]")
		.slice(0, MAX_ERROR_LENGTH);
}
