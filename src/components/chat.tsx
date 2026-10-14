import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { Popover } from "radix-ui";
import type { ComponentProps } from "react";
import { memo, useMemo } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseCitationMarkers } from "#/lib/citations";
import type { CitationRecord } from "#/modules/conversation";

/** Message metadata attached to stored messages. */
export interface ChatMeta {
	citations?: CitationRecord[];
	finishReason?: string | null;
	error?: string | null;
}

type Marker = ReturnType<typeof parseCitationMarkers>[number];

const keyOf = (locator: string, quote: string) => `${locator}\u0000${quote}`;

export function citationIndex(records: CitationRecord[]) {
	return new Map(records.map((r) => [keyOf(r.locator, r.quote), r]));
}

/** A server-verified citation whose book is still in the conversation. */
export type VerifiedCitation = CitationRecord & { currentLocator: string };

function isLive(
	record: CitationRecord | undefined,
	remainingBookIds: Set<string>,
): record is VerifiedCitation {
	return (
		record?.status === "verified" &&
		!!record.currentLocator &&
		!(record.editionId && !remainingBookIds.has(record.editionId))
	);
}

/**
 * Numbers live verified citations 1..n in order of first appearance across all
 * text parts of a message. Repeats of the same passage and quote share a number.
 */
export function numberCitations(
	texts: string[],
	citations: Map<string, CitationRecord>,
	remainingBookIds: Set<string>,
) {
	const numbers = new Map<string, number>();
	const sources: VerifiedCitation[] = [];
	for (const text of texts) {
		for (const { locator, quote } of parseCitationMarkers(text)) {
			const key = keyOf(locator, quote);
			const record = citations.get(key);
			if (numbers.has(key) || !isLive(record, remainingBookIds)) continue;
			sources.push(record);
			numbers.set(key, sources.length);
		}
	}
	return { numbers, sources };
}

export interface CitationContext {
	citations: Map<string, CitationRecord>;
	numbers: Map<string, number>;
	/** Editions still in the conversation; citations to others say the book is gone. */
	remainingBookIds: Set<string>;
}

const CITE_SCHEME = "cite:";

/**
 * Swaps each citation marker for a markdown link `[c](cite:<index>)` so the
 * markdown parser handles the surrounding text. An unfinished marker that is
 * still streaming is hidden instead of flashing as raw text.
 */
function prepare(text: string, markers: Marker[]) {
	let out = "";
	let at = 0;
	markers.forEach((m, i) => {
		out += `${text.slice(at, m.start)}[c](${CITE_SCHEME}${i})`;
		at = m.end;
	});
	out += text.slice(at);
	const open = out.lastIndexOf("[[cite");
	return open !== -1 && !out.includes("]]", open) ? out.slice(0, open) : out;
}

const heading = (cls: string) =>
	function Heading({ children }: ComponentProps<"h2">) {
		return <p className={cls}>{children}</p>;
	};

function buildComponents(markers: Marker[], ctx: CitationContext): Components {
	return {
		h1: heading("mt-4 mb-1 text-lg font-semibold"),
		h2: heading("mt-4 mb-1 text-base font-semibold"),
		h3: heading("mt-3 mb-1 font-semibold"),
		h4: heading("mt-3 mb-1 font-semibold"),
		p: ({ children }) => <p className="my-2">{children}</p>,
		ul: ({ children }) => (
			<ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>
		),
		ol: ({ children }) => (
			<ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>
		),
		blockquote: ({ children }) => (
			<blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">
				{children}
			</blockquote>
		),
		hr: () => <hr className="my-4" />,
		code: ({ children }) => (
			<code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
				{children}
			</code>
		),
		pre: ({ children }) => (
			<pre className="my-2 overflow-auto rounded-md bg-muted p-3 text-sm">
				{children}
			</pre>
		),
		table: ({ children }) => (
			<div className="my-2 overflow-x-auto">
				<table className="w-full border-collapse text-sm">{children}</table>
			</div>
		),
		th: ({ children }) => (
			<th className="border-b px-2 py-1 text-left font-medium">{children}</th>
		),
		td: ({ children }) => <td className="border-b px-2 py-1">{children}</td>,
		a: ({ href, children }) => {
			if (href?.startsWith(CITE_SCHEME)) {
				const marker = markers[Number(href.slice(CITE_SCHEME.length))];
				if (!marker) return null;
				const key = keyOf(marker.locator, marker.quote);
				return (
					<CitationMarker
						quote={marker.quote}
						record={ctx.citations.get(key)}
						number={ctx.numbers.get(key)}
					/>
				);
			}
			return (
				<a
					href={href}
					target="_blank"
					rel="noreferrer noopener"
					className="text-primary underline underline-offset-2"
				>
					{children}
				</a>
			);
		},
	};
}

const REMARK_PLUGINS = [remarkGfm];

const urlTransform = (url: string) =>
	url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url);

/** Assistant text rendered as markdown, with citation markers as numbered, clickable markers. */
export const AssistantText = memo(function AssistantText({
	text,
	citations,
	numbers,
	remainingBookIds,
}: { text: string } & CitationContext) {
	const markers = useMemo(() => parseCitationMarkers(text), [text]);
	const source = useMemo(() => prepare(text, markers), [text, markers]);
	const components = useMemo(
		() => buildComponents(markers, { citations, numbers, remainingBookIds }),
		[markers, citations, numbers, remainingBookIds],
	);
	return (
		<div className="leading-relaxed">
			<Markdown
				remarkPlugins={REMARK_PLUGINS}
				components={components}
				urlTransform={urlTransform}
			>
				{source}
			</Markdown>
		</div>
	);
});

const UNVERIFIED_REASON: Record<string, string> = {
	not_found: "no such passage",
	quote_mismatch: "quote not found in that passage",
	removed: "passage no longer exists",
	not_in_conversation: "passage is from a book outside this conversation",
};

const cardClass =
	"z-50 w-80 max-w-[90vw] rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md";

function sourceLabel(record: CitationRecord) {
	return [record.bookTitle, record.sectionTitle].filter(Boolean).join(" · ");
}

function passageLink(record: VerifiedCitation) {
	const range = record.range;
	return {
		to: "/p/$locator" as const,
		params: { locator: record.currentLocator },
		search: range ? { hl: `${range.start}-${range.end}` } : {},
	};
}

/**
 * Inline citation. Only server-verified citations get a number and link to the
 * passage; everything else (including markers with no stored verdict) is a
 * warning icon, and its quote is never styled as book text.
 */
function CitationMarker({
	quote,
	record,
	number,
}: {
	quote: string;
	record: CitationRecord | undefined;
	number: number | undefined;
}) {
	if (record?.status === "verified" && record.currentLocator && number) {
		const verified = record as VerifiedCitation;
		return (
			<Popover.Root>
				<Popover.Trigger asChild>
					<button
						type="button"
						className="mx-0.5 inline-flex min-w-5 cursor-pointer items-center justify-center rounded-full bg-highlight/60 px-1.5 align-super text-[0.7rem] font-medium leading-5 text-foreground hover:bg-highlight focus-visible:outline-2 focus-visible:outline-ring"
						aria-label={`Source ${number}: ${sourceLabel(verified) || "passage"}`}
						data-citation-status="verified"
					>
						{number}
					</button>
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content
						side="top"
						sideOffset={6}
						collisionPadding={8}
						className={cardClass}
					>
						<Link
							{...passageLink(verified)}
							className="block rounded-sm no-underline hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
						>
							<p className="border-l-2 border-l-primary pl-2 font-serif italic">
								“{quote}”
							</p>
							<p className="mt-2 text-xs text-muted-foreground">
								{sourceLabel(verified) || "Passage"} · open in book →
							</p>
						</Link>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		);
	}
	const reason =
		record?.status === "verified"
			? "book is no longer in the library"
			: record
				? UNVERIFIED_REASON[record.status]
				: "not checked";
	return (
		<Popover.Root>
			<Popover.Trigger asChild>
				<button
					type="button"
					className="mx-0.5 inline-flex align-super text-muted-foreground"
					aria-label={`Could not verify citation (${reason})`}
					data-citation-status="unverified"
				>
					<TriangleAlert className="size-3.5" aria-hidden />
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="top"
					sideOffset={6}
					collisionPadding={8}
					className={cardClass}
				>
					<p className="font-medium">Could not verify ({reason})</p>
					<p className="mt-1 text-xs text-muted-foreground">claimed: {quote}</p>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

/** Numbered list of the passages cited in a message; each entry opens the passage. */
export function SourcesList({ sources }: { sources: VerifiedCitation[] }) {
	if (sources.length === 0) return null;
	return (
		<section aria-label="Sources" className="mt-3 border-t pt-2 text-sm">
			<h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Sources
			</h3>
			<ol className="space-y-1">
				{sources.map((s, i) => (
					<li key={keyOf(s.locator, s.quote)} className="flex gap-2">
						<span className="w-5 shrink-0 text-right text-muted-foreground">
							{i + 1}.
						</span>
						<Link {...passageLink(s)} className="min-w-0 hover:underline">
							<span className="font-serif italic">“{s.quote}”</span>
							<span className="ml-1.5 text-xs text-muted-foreground">
								{sourceLabel(s) || "passage"} →
							</span>
						</Link>
					</li>
				))}
			</ol>
		</section>
	);
}
