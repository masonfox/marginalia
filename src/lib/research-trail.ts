/** Reader-facing view of an assistant message's tool activity. */

export interface ToolPartLike {
	type: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

export type StepKind = "search" | "read" | "outline" | "other";
export type StepStatus = "running" | "ok" | "empty" | "failed" | "unavailable";

export interface StepPassage {
	locator: string;
	text: string;
	section?: string;
	bookTitle?: string;
}

export interface Step {
	kind: StepKind;
	status: StepStatus;
	label: string;
	/** Short result or failure text shown beside the label. */
	detail?: string;
	passages: StepPassage[];
	raw: { input: unknown; output: unknown; errorText?: string };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
	typeof v === "string" && v.length > 0 ? v : undefined;

const toolName = (type: string) => type.replace(/^tool-/, "");

export function isToolLike(part: { type: string }): part is ToolPartLike {
	return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function kindOf(part: ToolPartLike): StepKind {
	const name =
		part.type === "dynamic-tool"
			? String((part as { toolName?: unknown }).toolName ?? "")
			: toolName(part.type);
	if (name === "searchBooks") return "search";
	if (name === "readPassage") return "read";
	if (name === "getOutline") return "outline";
	return "other";
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

function genericLabel(part: ToolPartLike) {
	const name = toolName(part.type);
	return `Used ${name === "dynamic-tool" ? "a tool" : name}`;
}

function describeSearch(
	input: Record<string, unknown>,
	output: unknown,
): Pick<Step, "status" | "label" | "detail" | "passages"> {
	const query = str(input.query);
	const label = query ? `Searched for “${query}”` : "Searched the book";
	if (!isRecord(output)) {
		return { status: "ok", label, passages: [] };
	}
	if (output.status === "unknown_book") {
		return {
			status: "failed",
			label,
			detail: str(output.message) ?? "Unknown book.",
			passages: [],
		};
	}
	const results = Array.isArray(output.results) ? output.results : [];
	const passages: StepPassage[] = [];
	for (const r of results) {
		if (!isRecord(r)) continue;
		const locator = str(r.locator);
		if (!locator) continue;
		passages.push({
			locator,
			text: typeof r.text === "string" ? r.text : "",
			section: str(r.section),
			bookTitle: str(r.bookTitle),
		});
	}
	const count =
		typeof output.count === "number" ? output.count : passages.length;
	if (count === 0) {
		return { status: "empty", label, detail: "no matches", passages };
	}
	return { status: "ok", label, detail: plural(count, "result"), passages };
}

const UNAVAILABLE: Record<string, string> = {
	not_found: "Passage not found",
	removed: "Passage no longer exists",
	not_in_conversation: "Passage is from a book outside this conversation",
};

function describeRead(
	input: Record<string, unknown>,
	output: unknown,
): Pick<Step, "status" | "label" | "detail" | "passages"> {
	const fallback = str(input.locator) ?? "passage";
	if (!isRecord(output)) {
		return { status: "ok", label: `Read ${fallback}`, passages: [] };
	}
	const status = str(output.status);
	if (status && status !== "ok") {
		const locator = str(output.locator) ?? fallback;
		return {
			status: "unavailable",
			label: `Read ${locator}`,
			detail: UNAVAILABLE[status] ?? `Unavailable (${status})`,
			passages: [],
		};
	}
	const path = Array.isArray(output.path)
		? output.path.filter((p): p is string => typeof p === "string" && !!p)
		: [];
	const section = str(output.section);
	const label = path.length > 0 ? path.join(" › ") : (section ?? fallback);
	const passage = isRecord(output.passage) ? output.passage : undefined;
	const locator = str(passage?.locator) ?? str(input.locator);
	const passages: StepPassage[] = locator
		? [
				{
					locator,
					text: typeof passage?.text === "string" ? passage.text : "",
					section: section ?? (path.length > 0 ? path.at(-1) : undefined),
					bookTitle: str(output.bookTitle),
				},
			]
		: [];
	return { status: "ok", label, passages };
}

export function describeStep(part: ToolPartLike): Step {
	const raw = {
		input: part.input,
		output: part.output,
		errorText: part.errorText,
	};
	const kind = kindOf(part);
	const input = isRecord(part.input) ? part.input : {};
	const base = { kind, passages: [] as StepPassage[], raw };

	if (part.state === "output-error") {
		const label =
			kind === "search"
				? describeSearch(input, undefined).label
				: kind === "read"
					? describeRead(input, undefined).label
					: kind === "outline"
						? "Browsed the table of contents"
						: genericLabel(part);
		return {
			...base,
			status: "failed",
			label,
			detail: part.errorText || "The tool failed.",
		};
	}

	if (
		part.output === undefined ||
		part.state === "input-streaming" ||
		part.state === "input-available"
	) {
		const label =
			kind === "search"
				? str(input.query)
					? `Searching for “${str(input.query)}”…`
					: "Searching…"
				: kind === "read"
					? "Reading passage…"
					: kind === "outline"
						? "Browsing the table of contents…"
						: `${genericLabel(part)}…`;
		return { ...base, status: "running", label };
	}

	try {
		if (kind === "search")
			return { ...base, ...describeSearch(input, part.output) };
		if (kind === "read")
			return { ...base, ...describeRead(input, part.output) };
		if (kind === "outline") {
			const o = part.output;
			if (isRecord(o) && o.status === "unknown_book") {
				return {
					...base,
					status: "failed",
					label: "Browsed the table of contents",
					detail: str(o.message) ?? "Unknown book.",
				};
			}
			return { ...base, status: "ok", label: "Browsed the table of contents" };
		}
	} catch {
		// fall through to the generic step
	}
	return { ...base, status: "ok", label: genericLabel(part) };
}

export type Block<P extends { type: string }> =
	| { type: "text"; part: Extract<P, { type: "text" }>; index: number }
	| { type: "trail"; parts: (P & ToolPartLike)[]; index: number };

/**
 * Splits message parts into text blocks and trail blocks. A trail is a run of
 * consecutive tool parts; a non-empty text part ends it. Other part types and
 * empty text parts are ignored.
 */
export function groupParts<P extends { type: string; text?: string }>(
	parts: P[],
): Block<P>[] {
	const blocks: Block<P>[] = [];
	let trail: (P & ToolPartLike)[] | null = null;
	parts.forEach((part, index) => {
		if (part.type === "text") {
			if (!part.text) return;
			trail = null;
			blocks.push({
				type: "text",
				part: part as Extract<P, { type: "text" }>,
				index,
			});
		} else if (isToolLike(part)) {
			if (!trail) {
				trail = [];
				blocks.push({ type: "trail", parts: trail, index });
			}
			trail.push(part as P & ToolPartLike);
		}
	});
	return blocks;
}

export function summarizeTrail(steps: Pick<Step, "kind">[]): string {
	const searches = steps.filter((s) => s.kind === "search").length;
	const reads = steps.filter((s) => s.kind === "read").length;
	const bits = ["Researched"];
	if (searches > 0) bits.push(plural(searches, "search", "searches"));
	if (reads > 0) bits.push(`${plural(reads, "passage")} read`);
	return bits.join(" · ");
}
