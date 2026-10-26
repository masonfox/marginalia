import { APICallError } from "ai";

/** Longest reader-visible error message. */
export const MAX_ERROR_LENGTH = 500;

/** A reader-safe message for an AI call error. Never includes credentials. */
export function describeError(error: unknown): string {
	if (APICallError.isInstance(error)) {
		const status = error.statusCode ? ` (HTTP ${error.statusCode})` : "";
		const hint =
			error.statusCode === 401 || error.statusCode === 403
				? " Check the provider key in Settings and that the key may use this model."
				: "";
		return redactSecrets(
			`The AI provider returned an error${status}: ${error.message}.${hint}`,
		);
	}
	if (error instanceof Error) return redactSecrets(error.message);
	return "The AI provider failed.";
}

/** Known secrets, such as the configured API key; registered on the server only. */
const secrets = new Set<string>();

/**
 * Masks every occurrence of `value` in later error messages, whatever its
 * length; undefined and empty values are ignored. A short key may also blank
 * the same string where it appears elsewhere in error text, which is accepted
 * because these are only error messages.
 */
export function registerSecret(value: string | undefined): void {
	if (value) secrets.add(value);
}

/** Forgets every registered secret. For tests. */
export function clearSecrets(): void {
	secrets.clear();
}

/** Masks registered secrets, then anything shaped like an API key. Does not truncate. */
export function maskSecrets(text: string): string {
	let masked = text;
	// Longest first, so a secret inside a longer one cannot leave part of it behind.
	const longestFirst = [...secrets].sort((a, b) => b.length - a.length);
	for (const secret of longestFirst)
		masked = masked.replaceAll(secret, "[redacted]");
	return masked.replace(
		/(?<![A-Za-z0-9])(sk|key|AIza)[-_A-Za-z0-9]{12,}/g,
		"[redacted]",
	);
}

/** Masks and truncates, in case a provider echoes a key. */
export function redactSecrets(message: string): string {
	return maskSecrets(message).slice(0, MAX_ERROR_LENGTH);
}
