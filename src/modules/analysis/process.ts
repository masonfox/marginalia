import { generateText, type LanguageModel } from "ai";
import { and, asc, between, eq } from "drizzle-orm";
import type { AiRuntime, ProviderOptions } from "#/modules/ai";
import { passages, type ReadingUnit } from "#/modules/catalog";
import { findQuote } from "#/modules/retrieval";
import {
	addUsage,
	NO_USAGE,
	recordUsage,
	type TokenUsage,
} from "#/modules/usage";
import type { Executor } from "#/server/db";
import {
	buildUnitPrompt,
	type PromptPassage,
	parseUnitOutput,
	UNIT_SYSTEM_PROMPT,
	type UnitOutput,
} from "./prompts";
import { normalizeNameKey, type UnitResult } from "./queries";
import type { DerivedCitation, ObservationKind } from "./schema";

/** Characters of passage text per model call; longer units are split. */
export const CHUNK_CHARS = 24_000;
const MAX_CITATIONS = 3;

export interface ProcessDeps {
	db: Executor;
	model: LanguageModel;
	modelName: string;
	provider: string;
	editionId: string;
	chunkChars?: number;
	signal?: AbortSignal;
	/** Configured reasoning effort; undefined leaves the provider default. */
	reasoning?: AiRuntime["reasoning"];
	/** Provider-specific call options, such as Anthropic prompt caching. */
	providerOptions?: ProviderOptions;
}

export async function loadUnitPassages(
	db: Executor,
	editionId: string,
	unit: Pick<ReadingUnit, "startPosition" | "endPosition">,
): Promise<PromptPassage[]> {
	return db
		.select({ locator: passages.locator, text: passages.text })
		.from(passages)
		.where(
			and(
				eq(passages.editionId, editionId),
				between(passages.position, unit.startPosition, unit.endPosition),
			),
		)
		.orderBy(asc(passages.position));
}

/**
 * Groups passages into chunks of at most `cap` prompt characters, counting
 * each passage's locator prefix. A passage too long for one chunk is sliced;
 * every slice keeps its locator, so citations verify against the full text.
 */
export function chunkPassages(
	items: PromptPassage[],
	cap: number,
): PromptPassage[][] {
	const chunks: PromptPassage[][] = [];
	let cur: PromptPassage[] = [];
	let size = 0;
	for (const p of items) {
		// "[locator] " before the text and the blank line after it.
		const overhead = p.locator.length + 5;
		for (const text of sliceText(p.text, Math.max(1, cap - overhead))) {
			const length = overhead + text.length;
			if (cur.length > 0 && size + length > cap) {
				chunks.push(cur);
				cur = [];
				size = 0;
			}
			cur.push({ locator: p.locator, text });
			size += length;
		}
	}
	if (cur.length > 0) chunks.push(cur);
	return chunks;
}

/** Splits text into pieces of at most `max` characters, never inside a surrogate pair. */
function sliceText(text: string, max: number): string[] {
	if (text.length <= max) return [text];
	const pieces: string[] = [];
	let at = 0;
	while (at < text.length) {
		let end = Math.min(at + max, text.length);
		const last = text.charCodeAt(end - 1);
		if (end < text.length && end - at > 1 && last >= 0xd800 && last <= 0xdbff)
			end--;
		pieces.push(text.slice(at, end));
		at = end;
	}
	return pieces;
}

/** Verifies citations against the unit's own passages only. Anything else is stored unverified. */
export function verifyCitations(
	cites: { locator: string; quote: string }[],
	byLocator: Map<string, string>,
): DerivedCitation[] {
	return cites.slice(0, MAX_CITATIONS).map((c) => {
		const text = byLocator.get(c.locator);
		return {
			locator: c.locator,
			quote: c.quote,
			verified: text !== undefined && findQuote(text, c.quote) !== null,
		};
	});
}

async function callModel(
	deps: ProcessDeps,
	prompt: string,
): Promise<UnitOutput> {
	let usage: TokenUsage = NO_USAGE;
	let reported = false;
	const record = (complete: boolean) =>
		recordUsage(deps.db, {
			...usage,
			purpose: "preprocess",
			conversationId: null,
			editionId: deps.editionId,
			messageId: null,
			provider: deps.provider,
			model: deps.modelName,
			steps: 1,
			complete,
		}).catch(() => {});
	let text: string;
	try {
		const result = await generateText({
			model: deps.model,
			system: UNIT_SYSTEM_PROMPT,
			prompt,
			reasoning: deps.reasoning,
			providerOptions: deps.providerOptions,
			abortSignal: deps.signal,
		});
		usage = addUsage(NO_USAGE, result.usage);
		reported = true;
		text = result.text;
	} catch (err) {
		// A failed call that reported no usage has nothing to record.
		if (reported) await record(false);
		throw err;
	}
	try {
		const out = parseUnitOutput(text);
		await record(true);
		return out;
	} catch (err) {
		await record(false);
		throw err;
	}
}

/**
 * Processes one reading unit. The model sees only this unit's passages and the
 * previous unit's summary.
 */
export async function processUnit(
	deps: ProcessDeps,
	unit: ReadingUnit,
	previousSummary: string | null,
): Promise<UnitResult> {
	const unitPassages = await loadUnitPassages(deps.db, deps.editionId, unit);
	if (unitPassages.length === 0) {
		throw new Error(`Unit ${unit.label} has no text`);
	}
	const byLocator = new Map(unitPassages.map((p) => [p.locator, p.text]));
	const chunks = chunkPassages(unitPassages, deps.chunkChars ?? CHUNK_CHARS);
	const outputs: UnitOutput[] = [];
	for (const [index, chunk] of chunks.entries()) {
		outputs.push(
			await callModel(
				deps,
				buildUnitPrompt({
					unitLabel: unit.label,
					previousSummary,
					passages: chunk,
					part: chunks.length > 1 ? { index, of: chunks.length } : undefined,
				}),
			),
		);
	}
	return mergeOutputs(unit, deps.modelName, outputs, byLocator);
}

interface Merged {
	name: string;
	kind: ObservationKind;
	notes: string[];
	cites: { locator: string; quote: string }[];
}

/** Merges chunk outputs: summaries concatenated, observations merged by name key. */
export function mergeOutputs(
	unit: Pick<ReadingUnit, "ordinal" | "label" | "endPosition">,
	model: string,
	outputs: UnitOutput[],
	byLocator: Map<string, string>,
): UnitResult {
	const merged = new Map<string, Merged>();
	for (const o of outputs) {
		for (const ob of o.observations) {
			const key = normalizeNameKey(ob.name);
			if (!key) continue;
			const cur = merged.get(key);
			if (!cur) {
				merged.set(key, {
					name: ob.name,
					kind: ob.kind,
					notes: [ob.note],
					cites: [...ob.citations],
				});
			} else {
				if (!cur.notes.includes(ob.note)) cur.notes.push(ob.note);
				cur.cites.push(...ob.citations);
			}
		}
	}
	return {
		unitOrdinal: unit.ordinal,
		unitLabel: unit.label,
		endPosition: unit.endPosition,
		summary: outputs.map((o) => o.summary.trim()).join(" "),
		summaryCitations: verifyCitations(
			outputs.flatMap((o) => o.citations),
			byLocator,
		),
		observations: [...merged.values()].map((m) => ({
			name: m.name,
			kind: m.kind,
			note: m.notes.join(" "),
			citations: verifyCitations(m.cites, byLocator),
		})),
		model,
	};
}
