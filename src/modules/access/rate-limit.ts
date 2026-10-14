export interface RateLimitOptions {
	maxFailures?: number;
	windowMs?: number;
	now?: () => number;
}

/**
 * Fixed-window counter of failed logins per client, in memory. After
 * `maxFailures` failures in a window, every attempt from that client is
 * rejected until the window ends, whether or not the password is correct.
 */
export class LoginRateLimiter {
	private readonly windows = new Map<
		string,
		{ start: number; failures: number }
	>();
	private readonly maxFailures: number;
	private readonly windowMs: number;
	private readonly now: () => number;

	constructor(options: RateLimitOptions = {}) {
		this.maxFailures = options.maxFailures ?? 10;
		this.windowMs = options.windowMs ?? 15 * 60 * 1000;
		this.now = options.now ?? Date.now;
	}

	isBlocked(client: string): boolean {
		const w = this.current(client);
		return w !== undefined && w.failures >= this.maxFailures;
	}

	recordFailure(client: string): void {
		const w = this.current(client) ?? { start: this.now(), failures: 0 };
		w.failures++;
		this.windows.set(client, w);
		if (this.windows.size > 10_000) this.prune();
	}

	private current(client: string) {
		const w = this.windows.get(client);
		if (w && this.now() - w.start >= this.windowMs) {
			this.windows.delete(client);
			return undefined;
		}
		return w;
	}

	private prune() {
		for (const key of [...this.windows.keys()]) this.current(key);
	}
}

/**
 * The client address for rate limiting: the socket address, or the first
 * `X-Forwarded-For` hop when the operator trusts a proxy in front.
 */
export function clientAddress(
	request: Request,
	socketAddress: string | undefined,
	trustProxy: boolean,
): string {
	if (trustProxy) {
		const forwarded = request.headers
			.get("x-forwarded-for")
			?.split(",")[0]
			?.trim();
		if (forwarded) return forwarded;
	}
	return socketAddress ?? "unknown";
}
