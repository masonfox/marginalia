// Reader-facing formatting of token usage and estimated costs.

export interface UsageFigures {
	inputTokens: number | null;
	outputTokens: number | null;
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
	reasoningTokens: number | null;
	estimatedCost: number | null;
}

/** 950, 1.2k, 48.2k, 1.3M. */
export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

/** An estimate in dollars, always marked approximate: ~$0.07, <$0.01. */
export function formatCost(usd: number): string {
	if (usd === 0) return "~$0.00";
	if (usd < 0.01) return "<$0.01";
	return `~$${usd.toFixed(2)}`;
}

/** One reply's line: "31.0k in (27.4k cached) · 1.2k out · ~$0.02". */
export function replyUsageLine(u: UsageFigures): string {
	const parts: string[] = [];
	if (u.inputTokens !== null) {
		const cached = u.cacheReadTokens
			? ` (${formatTokens(u.cacheReadTokens)} cached)`
			: "";
		parts.push(`${formatTokens(u.inputTokens)} in${cached}`);
	}
	if (u.outputTokens !== null) {
		parts.push(`${formatTokens(u.outputTokens)} out`);
	}
	parts.push(
		u.estimatedCost === null ? "cost unknown" : formatCost(u.estimatedCost),
	);
	return parts.join(" · ");
}

/** The conversation total: "48.2k tokens · ~$0.07 est.". */
export function totalUsageLine(u: UsageFigures): string {
	const tokens = (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
	const cost =
		u.estimatedCost === null
			? "cost unknown"
			: `${formatCost(u.estimatedCost)} est.`;
	return `${formatTokens(tokens)} tokens · ${cost}`;
}

/** Exact figures for a tooltip, one per line. Unreported counts are omitted. */
export function exactUsage(u: UsageFigures): string {
	const rows: [string, number | null][] = [
		["Input", u.inputTokens],
		["  cache read", u.cacheReadTokens],
		["  cache write", u.cacheWriteTokens],
		["Output", u.outputTokens],
		["  reasoning", u.reasoningTokens],
	];
	const lines = rows
		.filter(([, n]) => n !== null)
		.map(([label, n]) => `${label}: ${(n as number).toLocaleString("en-US")}`);
	lines.push(
		u.estimatedCost === null
			? "Estimated cost: unknown (no price for this model)"
			: `Estimated cost: $${u.estimatedCost.toFixed(4)}`,
	);
	return lines.join("\n");
}
