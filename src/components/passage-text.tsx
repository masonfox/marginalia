import { Fragment, type ReactNode } from "react";

interface Range {
	start: number;
	end: number;
}

/** A run of a passage's text, glossed or not. */
export interface TextSegment<G extends Range> {
	start: number;
	text: string;
	gloss: G | null;
}

/** Consecutive segments inside or outside the highlighted range. */
export interface TextBlock<G extends Range> {
	highlighted: boolean;
	segments: TextSegment<G>[];
}

/**
 * Splits a passage's text at the highlighted range and the gloss ranges.
 * The segments' text, in order, is exactly `text`. A gloss that crosses an
 * edge of the highlight, or another gloss, is left unmarked.
 */
export function segmentPassage<G extends Range>(
	text: string,
	range: Range | null,
	glosses: G[] = [],
): TextBlock<G>[] {
	const highlight =
		range && range.start < range.end && range.end <= text.length ? range : null;
	const crosses = (g: Range) =>
		highlight !== null &&
		g.start < highlight.end &&
		g.end > highlight.start &&
		(g.start < highlight.start || g.end > highlight.end);
	const marks: G[] = [];
	for (const g of [...glosses].sort((a, b) => a.start - b.start)) {
		const previous = marks.at(-1);
		if (g.start >= g.end || g.end > text.length || crosses(g)) continue;
		if (previous && g.start < previous.end) continue;
		marks.push(g);
	}
	const cuts = new Set([0, text.length]);
	if (highlight) {
		cuts.add(highlight.start);
		cuts.add(highlight.end);
	}
	for (const g of marks) {
		cuts.add(g.start);
		cuts.add(g.end);
	}
	const edges = [...cuts].sort((a, b) => a - b);
	const blocks: TextBlock<G>[] = [];
	for (const [i, start] of edges.slice(0, -1).entries()) {
		const end = edges[i + 1] as number;
		const highlighted =
			highlight !== null && start >= highlight.start && end <= highlight.end;
		const gloss = marks.find((g) => g.start <= start && end <= g.end) ?? null;
		const segment = { start, text: text.slice(start, end), gloss };
		const last = blocks.at(-1);
		if (last?.highlighted === highlighted) last.segments.push(segment);
		else blocks.push({ highlighted, segments: [segment] });
	}
	return blocks;
}

/**
 * A passage's text, with an optional highlighted range and marked glosses.
 * Its DOM text equals `text`, so selection offsets inside it (see
 * selectionToPassageRef) are offsets into the stored passage.
 */
export function PassageText<G extends Range>({
	locator,
	text,
	range,
	glosses,
	renderGloss,
}: {
	locator: string;
	text: string;
	range: Range | null;
	glosses?: G[];
	/** Renders a glossed run; it must render `text` as its only text. */
	renderGloss?: (gloss: G, text: string) => ReactNode;
}) {
	const blocks = segmentPassage(text, range, renderGloss ? glosses : []);
	const segment = (s: TextSegment<G>) => (
		<Fragment key={s.start}>
			{s.gloss && renderGloss ? renderGloss(s.gloss, s.text) : s.text}
		</Fragment>
	);
	return (
		<span data-passage-text={locator}>
			{blocks.map((b) =>
				b.highlighted ? (
					<mark
						key={b.segments[0]?.start}
						data-testid="quote-highlight"
						className="rounded-sm bg-primary/25 px-0.5 text-foreground"
					>
						{b.segments.map(segment)}
					</mark>
				) : (
					<Fragment key={b.segments[0]?.start}>
						{b.segments.map(segment)}
					</Fragment>
				),
			)}
		</span>
	);
}
