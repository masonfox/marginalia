// Typed failures a provider adapter throws from a sync, so the job layer can
// tell a reschedule (rate limited) from a configuration problem.

export type ProviderErrorReason =
	| "unreachable"
	| "rejected"
	| "rate-limited"
	| "invalid-response";

export class ProviderError extends Error {
	readonly reason: ProviderErrorReason;

	constructor(
		reason: ProviderErrorReason,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "ProviderError";
		this.reason = reason;
	}
}

/**
 * The provider kept answering 429 after the adapter's own retries. The job
 * layer should reschedule the sync, after `retryAfterMs` when it is known.
 */
export class RateLimitedError extends ProviderError {
	readonly retryAfterMs: number | undefined;

	constructor(message: string, retryAfterMs?: number) {
		super("rate-limited", message);
		this.name = "RateLimitedError";
		this.retryAfterMs = retryAfterMs;
	}
}
