import { Link } from "@tanstack/react-router";
import { BookOpen, ChevronRight, TriangleAlert } from "lucide-react";
import { Fragment } from "react";
import { segmentCitations } from "#/lib/citations";
import type { CitationRecord } from "#/modules/conversation";

/** Message metadata attached to stored messages. */
export interface ChatMeta {
	citations?: CitationRecord[];
	finishReason?: string | null;
	error?: string | null;
}

const keyOf = (locator: string, quote: string) => `${locator}\u0000${quote}`;

export function citationIndex(records: CitationRecord[]) {
	return new Map(records.map((r) => [keyOf(r.locator, r.quote), r]));
}

/** Assistant text with citation markers replaced by chips, and **bold** labels rendered. */
export function AssistantText({
	text,
	citations,
	remainingBookIds,
}: {
	text: string;
	citations: Map<string, CitationRecord>;
	/** Editions still in the conversation; citations to others say the book is gone. */
	remainingBookIds: Set<string>;
}) {
	let offset = 0;
	return (
		<div className="whitespace-pre-wrap leading-relaxed">
			{segmentCitations(text).map((segment) => {
				const key = offset;
				offset +=
					segment.kind === "text"
						? segment.text.length
						: segment.marker.end - segment.marker.start;
				if (segment.kind === "text") {
					return <Inline key={key} text={segment.text} />;
				}
				const { locator, quote } = segment.marker;
				return (
					<CitationChip
						key={key}
						quote={quote}
						record={citations.get(keyOf(locator, quote))}
						remainingBookIds={remainingBookIds}
					/>
				);
			})}
		</div>
	);
}

/** Renders `**bold**` without parsing anything else (no HTML). */
function Inline({ text }: { text: string }) {
	const parts = text.split(/(\*\*[^*\n]+\*\*)/g).filter((part) => part !== "");
	let offset = 0;
	return parts.map((part) => {
		const key = offset;
		offset += part.length;
		return part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
			<strong key={key}>{part.slice(2, -2)}</strong>
		) : (
			<Fragment key={key}>{part}</Fragment>
		);
	});
}

const UNVERIFIED_REASON: Record<string, string> = {
	not_found: "no such passage",
	quote_mismatch: "quote not found in that passage",
	removed: "passage no longer exists",
	not_in_conversation: "passage is from a book outside this conversation",
};

/**
 * A citation. Only server-verified citations look like evidence; everything
 * else (including markers with no stored verdict) is flagged and the quote is
 * not styled as book text.
 */
export function CitationChip({
	quote,
	record,
	remainingBookIds,
}: {
	quote: string;
	record: CitationRecord | undefined;
	remainingBookIds: Set<string>;
}) {
	if (
		record?.status === "verified" &&
		record.currentLocator &&
		record.editionId &&
		!remainingBookIds.has(record.editionId)
	) {
		return (
			<span className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 align-baseline text-sm text-muted-foreground">
				<TriangleAlert className="size-3" aria-hidden /> book no longer in
				library
			</span>
		);
	}
	if (record?.status === "verified" && record.currentLocator) {
		const range = record.range;
		return (
			<Link
				to="/p/$locator"
				params={{ locator: record.currentLocator }}
				search={range ? { hl: `${range.start}-${range.end}` } : {}}
				className="mx-0.5 inline-block rounded-md border-l-2 border-l-primary bg-highlight/50 px-2 py-0.5 align-baseline font-serif text-[0.95em] italic hover:bg-highlight"
				title={[record.bookTitle, record.sectionTitle]
					.filter(Boolean)
					.join(" · ")}
				data-citation-status="verified"
			>
				“{quote}”
				<span className="ml-1.5 inline-flex items-center gap-0.5 font-sans text-xs not-italic text-muted-foreground">
					<BookOpen className="size-3" aria-hidden />
					{record.sectionTitle ?? record.bookTitle ?? "passage"}
					<ChevronRight className="size-3" aria-hidden />
				</span>
			</Link>
		);
	}
	const reason = record ? UNVERIFIED_REASON[record.status] : "not checked";
	return (
		<span
			className="mx-0.5 inline-flex flex-wrap items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 align-baseline text-sm text-muted-foreground"
			data-citation-status="unverified"
		>
			<TriangleAlert className="size-3 shrink-0" aria-hidden />
			<span className="font-medium">Could not verify</span>
			<span>({reason})</span>
			<span className="text-xs">claimed: {quote}</span>
		</span>
	);
}

interface ToolPart {
	type: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

/** True for tool invocation parts (`tool-<name>` or dynamic tools). */
export function isToolPart(part: { type: string }): part is ToolPart {
	return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function describeTool(part: ToolPart): string {
	const input = (part.input ?? {}) as Record<string, unknown>;
	switch (part.type) {
		case "tool-searchBooks":
			return `Searched for “${String(input.query ?? "")}”`;
		case "tool-readPassage":
			return `Read passage ${String(input.locator ?? "")}`;
		case "tool-getOutline":
			return "Looked at the table of contents";
		default:
			return `Used ${part.type.replace(/^tool-/, "")}`;
	}
}

/** A collapsed row for one tool call, expandable to its raw result. */
export function ToolActivity({ part }: { part: ToolPart }) {
	const finished = part.state === "output-available";
	const failed = part.state === "output-error";
	const detail = failed
		? (part.errorText ?? "The tool failed.")
		: part.output === undefined
			? ""
			: JSON.stringify(part.output, null, 2).slice(0, 4000);
	return (
		<details className="rounded-md border bg-muted/30 px-3 py-1 text-sm text-muted-foreground">
			<summary className="cursor-pointer">
				{describeTool(part)}
				{!finished && !failed && " …"}
				{failed && " (failed)"}
			</summary>
			{detail && (
				<pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
					{detail}
				</pre>
			)}
		</details>
	);
}
