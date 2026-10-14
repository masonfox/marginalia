/** Polls `check` until it returns a truthy value or the timeout elapses. */
export async function waitFor<T>(
	check: () => T | Promise<T>,
	{ timeoutMs = 20_000, intervalMs = 100, what = "condition" } = {},
): Promise<Exclude<T, false | null | undefined | 0 | "">> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await check();
		if (value) return value as Exclude<T, false | null | undefined | 0 | "">;
		if (Date.now() > deadline) {
			throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
		}
		await sleep(intervalMs);
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
