import { ChevronDown, MessagesSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { relativeTime } from "#/lib/relative-time";
import { findQuoteRange, rangeContainsPoint } from "#/lib/thread-anchors";

/** The CSS highlight that underlines anchor text; styled in styles.css. */
export const ANCHOR_HIGHLIGHT = "thread-anchor";

/** The thread fields markers need. */
export interface MarkerThread {
	id: string;
	anchorQuote: string;
	updatedAt: Date | string;
}

/** Every response's underlined anchors, by response; one highlight shows them all. */
const underlines = new Map<string, Range[]>();

function syncHighlight() {
	const registry = globalThis.CSS?.highlights;
	if (!registry || typeof Highlight === "undefined") return;
	const ranges = [...underlines.values()].flat();
	if (ranges.length === 0) registry.delete(ANCHOR_HIGHLIGHT);
	else registry.set(ANCHOR_HIGHLIGHT, new Highlight(...ranges));
}

/** Most recently active first. */
const byActivity = (threads: MarkerThread[]) =>
	[...threads].sort(
		(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
	);

const excerpt = (text: string, max = 80) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * A response's thread markers: a chip with the number of threads below it,
 * and an underline on each anchor quote found in its displayed text.
 * Activating either opens the thread. Rendered inside the response, which
 * carries `data-message-id`.
 */
export function ThreadMarkers({
	messageId,
	threads,
	revision,
	onOpen,
}: {
	messageId: string;
	/** The response's threads, oldest first. */
	threads: MarkerThread[];
	/** Changes when the response's displayed text may have changed. */
	revision?: unknown;
	onOpen: (threadId: string) => void;
}) {
	const chip = useRef<HTMLDivElement>(null);
	const [underlined, setUnderlined] = useState(0);
	const onOpenRef = useRef(onOpen);
	onOpenRef.current = onOpen;
	const quotes = threads.map((t) => `${t.id}\u0000${t.anchorQuote}`).join("\n");

	// biome-ignore lint/correctness/useExhaustiveDependencies: matched again when the quotes or the text change
	useEffect(() => {
		const root = chip.current?.closest("[data-message-id]");
		if (!root) return;
		const found = threads.flatMap((t) => {
			const range = findQuoteRange(root, t.anchorQuote);
			return range ? [{ range, threadId: t.id }] : [];
		});
		setUnderlined(found.length);
		underlines.set(
			messageId,
			found.map((f) => f.range),
		);
		syncHighlight();
		const hit = (e: MouseEvent) =>
			found.find((f) => rangeContainsPoint(f.range, e.clientX, e.clientY));
		const click = (e: MouseEvent) => {
			// A drag that selected text is a selection, not a click on the anchor.
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed) return;
			if ((e.target as Element | null)?.closest("a,button")) return;
			const target = hit(e);
			if (target) onOpenRef.current(target.threadId);
		};
		const move = (e: MouseEvent) => {
			(root as HTMLElement).style.cursor = hit(e) ? "pointer" : "";
		};
		root.addEventListener("click", click as EventListener);
		root.addEventListener("mousemove", move as EventListener);
		return () => {
			root.removeEventListener("click", click as EventListener);
			root.removeEventListener("mousemove", move as EventListener);
			(root as HTMLElement).style.cursor = "";
			underlines.delete(messageId);
			syncHighlight();
		};
	}, [messageId, quotes, revision]);

	if (threads.length === 0) return null;
	const label = `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`;
	const chipClass =
		"inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-input px-3 text-xs font-medium text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring pointer-coarse:min-h-11";
	const [only] = threads;
	return (
		<div
			ref={chip}
			data-reply-excluded
			data-thread-marker
			data-underlined={underlined}
			data-testid="thread-markers"
		>
			{threads.length === 1 && only ? (
				<button
					type="button"
					className={chipClass}
					aria-label={`Open thread: ${excerpt(only.anchorQuote)}`}
					title={excerpt(only.anchorQuote)}
					onClick={() => onOpen(only.id)}
					data-testid="thread-chip"
				>
					<MessagesSquare className="size-3.5" aria-hidden />
					{label}
				</button>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className={chipClass}
							aria-label={`${label} on this response`}
							data-testid="thread-chip"
						>
							<MessagesSquare className="size-3.5" aria-hidden />
							{label}
							<ChevronDown className="size-3.5" aria-hidden />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						className="w-80 max-w-[calc(100vw-2rem)]"
						data-testid="thread-list"
					>
						{byActivity(threads).map((t) => (
							<DropdownMenuItem
								key={t.id}
								className="flex-col items-start gap-0.5"
								onSelect={() => onOpen(t.id)}
							>
								<span className="line-clamp-2 text-foreground">
									{excerpt(t.anchorQuote, 140)}
								</span>
								<span className="text-xs text-muted-foreground">
									{relativeTime(new Date(t.updatedAt))}
								</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}
