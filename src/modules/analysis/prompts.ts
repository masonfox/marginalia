import { z } from "zod";
import { OBSERVATION_KINDS } from "./schema";

/** Instructions for the per-unit call. Changing them requires bumping PREPROCESS_PROMPT_VERSION. */
export const UNIT_SYSTEM_PROMPT = `You prepare reading notes for one section (chapter) of a book.
You are given the text of this section only, as passages, each starting with a locator in square brackets. You may also be given the summary of the previous section for continuity.

Rules:
- Describe only what happens in THIS section. Do not use knowledge of the rest of the book, and do not predict or hint at later events, even if you recognise the book.
- The previous summary is context only; do not repeat it.
- "summary": 2 to 4 plain sentences about this section.
- "observations": characters, places, objects, and motifs that appear in this section. Each has a "name" (as the book names it), a "kind" (${OBSERVATION_KINDS.join(", ")}), and a short "note" of what appears or happens to it in this section.
- The summary and every observation must each cite at least one supporting passage in "citations": the passage locator exactly as given, and a short exact quote copied from that passage. Leave out any observation you cannot support with a quote.
- Do not describe the book as a whole and do not state themes of the whole book.
Reply with a single JSON object and nothing else:
{"summary": string, "citations": [{"locator": string, "quote": string}], "observations": [{"name": string, "kind": string, "note": string, "citations": [{"locator": string, "quote": string}]}]}`;

const nonblank = z.string().regex(/\S/);
const citation = z.object({ locator: nonblank, quote: nonblank });
/** At least one citation is required; unsupported output fails the unit. */
const citations = z.array(citation).min(1);

export const unitOutputSchema = z.object({
	summary: z.string().min(1),
	citations,
	observations: z
		.array(
			z.object({
				name: z.string().min(1),
				kind: z.enum(OBSERVATION_KINDS),
				note: z.string().min(1),
				citations,
			}),
		)
		.default([]),
});
export type UnitOutput = z.infer<typeof unitOutputSchema>;

export interface PromptPassage {
	locator: string;
	text: string;
}

/** Characters of the previous unit's summary sent as continuity; stored summaries are not cut. */
export const PREVIOUS_SUMMARY_CHARS = 2_000;

/** Keeps the end of a long previous summary, nearest this section, never cutting a surrogate pair. */
function continuity(summary: string): string {
	if (summary.length <= PREVIOUS_SUMMARY_CHARS) return summary;
	let tail = summary.slice(-PREVIOUS_SUMMARY_CHARS);
	const first = tail.charCodeAt(0);
	if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1);
	return `…${tail}`;
}

export function buildUnitPrompt(input: {
	unitLabel: string;
	previousSummary: string | null;
	passages: PromptPassage[];
	part?: { index: number; of: number };
}): string {
	const head = input.part
		? `Section: ${input.unitLabel} (part ${input.part.index + 1} of ${input.part.of})`
		: `Section: ${input.unitLabel}`;
	const prev = input.previousSummary
		? `Summary of the previous section (context only):\n${continuity(input.previousSummary)}\n\n`
		: "";
	const body = input.passages
		.map((p) => `[${p.locator}] ${p.text}`)
		.join("\n\n");
	return `${head}\n\n${prev}Text of this section:\n\n${body}`;
}

/** Returns the end index (exclusive) of the balanced object opening at `start`, or -1. Braces inside strings are ignored. */
function objectEnd(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (ch === "\\") i++;
			else if (ch === '"') inString = false;
		} else if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}" && --depth === 0) return i + 1;
	}
	return -1;
}

/**
 * Extracts and validates the first JSON object in a model reply. Tolerates code
 * fences, prose, and trailing content such as a stray brace or a second object.
 */
export function parseUnitOutput(text: string): UnitOutput {
	const start = text.indexOf("{");
	if (start < 0) throw new Error("Model reply had no JSON");
	const end = objectEnd(text, start);
	if (end < 0) throw new Error("Model reply had incomplete JSON");
	return unitOutputSchema.parse(JSON.parse(text.slice(start, end)));
}
