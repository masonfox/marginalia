/** Reader-facing view of an assistant message's tool activity. */

export interface ToolPartLike {
	type: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

export type StepKind =
	| "search"
	| "read"
	| "outline"
	/** The book map a reply was generated with: not a tool call, never counted. */
	| "guide"
	| "observations"
	| "notes"
	| "other";
export type StepStatus = "running" | "ok" | "empty" | "failed" | "unavailable";

export interface StepPassage {
	locator: string;
	text: string;
	section?: string;
	bookTitle?: string;
}

/** An observation a lookup returned, as the reply saw it. */
export interface StepObservation {
	unitLabel: string;
	/** The name it was recorded under. */
	observedAs: string;
	note: string;
	/** The reader's correction rather than generated text. */
	corrected: boolean;
}

/** A note a notes lookup returned. */
export interface StepNote {
	id: number;
	title: string;
}

/**
 * One book's map as a reply recorded it: the conversation module's
 * GuideContextEntry, which client code does not import.
 */
export interface GuideContextLike {
	editionId: string;
	scopeLabel: string | null;
	maxPosition: number | null;
	mapFingerprint: string;
}

export interface Step {
	kind: StepKind;
	status: StepStatus;
	label: string;
	/** Short result or failure text shown beside the label. */
	detail?: string;
	passages: StepPassage[];
	/** What an observation lookup returned. */
	observations?: StepObservation[];
	/** What a notes lookup returned. */
	notes?: StepNote[];
	/** The book handle a lookup was for, such as b1. */
	book?: string;
	/** The name an observation lookup looked up. */
	lookedUp?: string;
	/** The map a guide step describes. */
	guide?: GuideContextLike;
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
	if (name === "readPassage" || name === "readSection") return "read";
	if (name === "getOutline") return "outline";
	if (name === "lookupObservations") return "observations";
	if (name === "lookupNotes") return "notes";
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
	const shape = (locator: string, text: unknown): StepPassage => ({
		locator,
		text: typeof text === "string" ? text : "",
		section: section ?? (path.length > 0 ? path.at(-1) : undefined),
		bookTitle: str(output.bookTitle),
	});
	// readSection returns a run of passages; readPassage returns one.
	if (Array.isArray(output.passages)) {
		const passages: StepPassage[] = [];
		for (const p of output.passages) {
			const locator = isRecord(p) ? str(p.locator) : undefined;
			if (locator && isRecord(p)) passages.push(shape(locator, p.text));
		}
		return {
			status: "ok",
			label,
			detail: plural(passages.length, "passage"),
			passages,
		};
	}
	const passage = isRecord(output.passage) ? output.passage : undefined;
	const locator = str(passage?.locator) ?? str(input.locator);
	const passages = locator ? [shape(locator, passage?.text)] : [];
	return { status: "ok", label, passages };
}

/** An observation lookup's label: the name, and the subject when that differs. */
function observationsLabel(name: string | undefined, subject?: string) {
	if (!name) return "Looked up observations";
	const resolved =
		subject && subject.toLowerCase() !== name.toLowerCase()
			? ` (${subject})`
			: "";
	return `Looked up “${name}”${resolved}`;
}

function describeObservations(
	input: Record<string, unknown>,
	output: unknown,
): Pick<Step, "status" | "label" | "detail" | "observations"> {
	const name = str(input.name);
	if (!isRecord(output))
		return { status: "ok", label: observationsLabel(name), observations: [] };
	const label = observationsLabel(name, str(output.subject));
	if (output.status === "unknown_book")
		return {
			status: "failed",
			label,
			detail: str(output.message) ?? "Unknown book.",
			observations: [],
		};
	if (output.status === "unavailable")
		return {
			status: "unavailable",
			label,
			detail: "No observations for this book",
			observations: [],
		};
	if (output.status === "not_found")
		return { status: "empty", label, detail: "no matches", observations: [] };
	const observations: StepObservation[] = [];
	for (const r of Array.isArray(output.results) ? output.results : []) {
		if (!isRecord(r)) continue;
		observations.push({
			unitLabel: str(r.unitLabel) ?? "",
			// Replies from before reader corrections stored the name as `name`.
			observedAs: str(r.observedAs) ?? str(r.name) ?? "",
			note: typeof r.note === "string" ? r.note : "",
			corrected: r.source === "reader correction",
		});
	}
	const count =
		typeof output.count === "number" ? output.count : observations.length;
	if (count === 0)
		return { status: "empty", label, detail: "no matches", observations };
	return {
		status: "ok",
		label,
		detail: plural(count, "result"),
		observations,
	};
}

function notesLabel(input: Record<string, unknown>) {
	const query = str(input.query);
	const subject = str(input.subject);
	if (query) return `Checked your notes for “${query}”`;
	if (subject) return `Checked your notes on “${subject}”`;
	return "Checked your notes";
}

function describeNotes(
	input: Record<string, unknown>,
	output: unknown,
): Pick<Step, "status" | "label" | "detail" | "notes"> {
	const label = notesLabel(input);
	if (!isRecord(output)) return { status: "ok", label, notes: [] };
	if (output.status === "unknown_book")
		return {
			status: "failed",
			label,
			detail: str(output.message) ?? "Unknown book.",
			notes: [],
		};
	const notes: StepNote[] = [];
	for (const n of Array.isArray(output.notes) ? output.notes : []) {
		if (!isRecord(n) || typeof n.id !== "number") continue;
		notes.push({ id: n.id, title: str(n.title) ?? "Untitled note" });
	}
	const count = typeof output.count === "number" ? output.count : notes.length;
	if (output.status === "not_found" || count === 0)
		return { status: "empty", label, detail: "no notes", notes };
	return { status: "ok", label, detail: plural(count, "note"), notes };
}

/** A stored guide context's valid entries; older messages have none. */
function guideEntries(context: unknown): GuideContextLike[] {
	if (!Array.isArray(context)) return [];
	return context.flatMap((e): GuideContextLike[] =>
		isRecord(e) &&
		typeof e.editionId === "string" &&
		typeof e.mapFingerprint === "string" &&
		(typeof e.scopeLabel === "string" || e.scopeLabel === null) &&
		(typeof e.maxPosition === "number" || e.maxPosition === null)
			? [
					{
						editionId: e.editionId,
						scopeLabel: e.scopeLabel,
						maxPosition: e.maxPosition,
						mapFingerprint: e.mapFingerprint,
					},
				]
			: [],
	);
}

/**
 * The steps a reply's trail starts with: one per book whose map the reply
 * was generated with, described from what it recorded. Replies with no
 * recorded context, older ones included, have none.
 */
export function guideSteps(
	context: unknown,
	books: { editionId: string; title: string }[],
): Step[] {
	return guideEntries(context).map((guide) => {
		const book = books.find((b) => b.editionId === guide.editionId);
		const of = !book
			? " of a removed book"
			: books.length > 1
				? ` of ${book.title}`
				: "";
		const scope =
			guide.scopeLabel === null
				? "for the whole book"
				: `through ${guide.scopeLabel}`;
		return {
			kind: "guide",
			status: "ok",
			label: `Used chapter summaries${of} ${scope}`,
			passages: [],
			guide,
			raw: { input: guide, output: undefined },
		};
	});
}

export function describeStep(part: ToolPartLike): Step {
	const raw = {
		input: part.input,
		output: part.output,
		errorText: part.errorText,
	};
	const kind = kindOf(part);
	const input = isRecord(part.input) ? part.input : {};
	const base = {
		kind,
		passages: [] as StepPassage[],
		raw,
		...(kind === "observations" && {
			book: str(input.book),
			lookedUp: str(input.name),
		}),
		...(kind === "notes" && { book: str(input.book) }),
	};

	if (part.state === "output-error") {
		const label =
			kind === "search"
				? describeSearch(input, undefined).label
				: kind === "read"
					? describeRead(input, undefined).label
					: kind === "outline"
						? "Browsed the table of contents"
						: kind === "observations"
							? observationsLabel(str(input.name))
							: kind === "notes"
								? notesLabel(input)
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
					? toolName(part.type) === "readSection"
						? "Reading section…"
						: "Reading passage…"
					: kind === "outline"
						? "Browsing the table of contents…"
						: kind === "observations"
							? str(input.name)
								? `Looking up “${str(input.name)}”…`
								: "Looking up observations…"
							: kind === "notes"
								? "Checking your notes…"
								: `${genericLabel(part)}…`;
		return { ...base, status: "running", label };
	}

	try {
		if (kind === "search")
			return { ...base, ...describeSearch(input, part.output) };
		if (kind === "read")
			return { ...base, ...describeRead(input, part.output) };
		if (kind === "observations")
			return { ...base, ...describeObservations(input, part.output) };
		if (kind === "notes")
			return { ...base, ...describeNotes(input, part.output) };
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

/**
 * Counts passages actually read, so one readSection step can count many.
 * Guide steps are not research and are never counted; a trail of nothing
 * else says the guide was used.
 */
export function summarizeTrail(
	steps: Pick<Step, "kind" | "passages">[],
): string {
	if (steps.length > 0 && steps.every((s) => s.kind === "guide"))
		return "Used the book guide";
	const searches = steps.filter((s) => s.kind === "search").length;
	const reads = steps
		.filter((s) => s.kind === "read")
		.reduce((n, s) => n + s.passages.length, 0);
	const bits = ["Researched"];
	if (searches > 0) bits.push(plural(searches, "search", "searches"));
	if (reads > 0) bits.push(`${plural(reads, "passage")} read`);
	return bits.join(" · ");
}
