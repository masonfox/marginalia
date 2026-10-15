import { NotebookPen, Reply } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { REPLY_CONTEXT_LIMIT, type ReplyContext } from "#/lib/reply-context";

const BLOCKS = new Set([
	"P",
	"LI",
	"BLOCKQUOTE",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"TR",
	"DIV",
	"PRE",
	"BR",
]);

/** Selected text with citation pills left out, so their numbers never leak into the quote. */
function selectedText(range: Range): string {
	let out = "";
	let afterPill = false;
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			let text = node.textContent ?? "";
			// "claim [1] worth" would otherwise quote as "claim  worth".
			if (afterPill && /\s$/.test(out)) text = text.replace(/^[ \t]+/, "");
			out += text;
			afterPill = false;
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== 11) return;
		const el = node as Element;
		if (el.hasAttribute?.("data-citation-status")) {
			afterPill = true;
			return;
		}
		const block = BLOCKS.has(el.tagName);
		if (block && out && !out.endsWith("\n")) out += "\n";
		for (const child of Array.from(node.childNodes)) walk(child);
		if (block && !out.endsWith("\n")) out += "\n";
	};
	walk(range.cloneContents());
	return out
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Inspect every intersected subtree, including controls between text endpoints. */
export function captureReplySelection(
	selection: Selection | null,
): ReplyContext | null {
	if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
		return null;
	const range = selection.getRangeAt(0);
	const rootOf = (node: Node) =>
		(node.nodeType === Node.ELEMENT_NODE
			? (node as Element)
			: node.parentElement
		)?.closest<HTMLElement>("[data-reply-source]");
	const first = rootOf(range.startContainer);
	const last = rootOf(range.endContainer);
	const messageId = first?.dataset.replySource;
	if (!messageId || messageId !== last?.dataset.replySource) return null;
	const ancestor = range.commonAncestorContainer;
	const walker = document.createTreeWalker(
		ancestor,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
	);
	const valid = (node: Node) => {
		if (!range.intersectsNode(node)) return true;
		const element =
			node.nodeType === Node.ELEMENT_NODE
				? (node as Element)
				: node.parentElement;
		if (element?.closest("[data-reply-excluded],input,textarea")) return false;
		if (
			node.nodeType === Node.TEXT_NODE &&
			node.textContent?.trim() &&
			rootOf(node)?.dataset.replySource !== messageId
		)
			return false;
		return true;
	};
	if (!valid(ancestor)) return null;
	while (walker.nextNode()) if (!valid(walker.currentNode)) return null;
	const text = selectedText(range);
	return text ? { messageId, text } : null;
}

export function ReplySelection({
	onAttach,
	onTooLong,
	onSaveAsNote,
}: {
	/** Replies to the selection; absent when replies cannot be sent. */
	onAttach?: (quote: ReplyContext) => void;
	/** The selection is over the quote limit, so nothing was attached. */
	onTooLong: () => void;
	/** Starts a note from the selection; nothing is saved until the reader saves it. */
	onSaveAsNote?: (quote: ReplyContext) => void;
}) {
	const [snapshot, setSnapshot] = useState<
		(ReplyContext & { left: number; top: number }) | null
	>(null);
	const button = useRef<HTMLButtonElement>(null);
	const toolbar = useRef<HTMLDivElement>(null);
	const width = onAttach && onSaveAsNote ? 340 : 180;
	useEffect(() => {
		const update = (event?: Event) => {
			if (
				toolbar.current?.contains(document.activeElement) &&
				event?.type === "selectionchange"
			)
				return;
			const selection = window.getSelection();
			const quote = captureReplySelection(selection);
			if (!quote || !selection) {
				setSnapshot(null);
				return;
			}
			const rect = selection.getRangeAt(0).getBoundingClientRect();
			setSnapshot({
				...quote,
				left: Math.max(8, Math.min(rect.left, window.innerWidth - width)),
				// Above the selection like a native menu; below only when there is no room.
				top:
					rect.top >= 56
						? rect.top - 48
						: Math.min(rect.bottom + 8, window.innerHeight - 48),
			});
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") setSnapshot(null);
			// Native tab order can place the action after a distant composer. Move focus directly.
			if (
				event.key === "Tab" &&
				document.activeElement !== button.current &&
				button.current &&
				captureReplySelection(window.getSelection())
			) {
				event.preventDefault();
				button.current.focus();
			}
		};
		document.addEventListener("selectionchange", update);
		document.addEventListener("pointerup", update);
		document.addEventListener("touchend", update);
		document.addEventListener("keydown", key);
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);
		return () => {
			document.removeEventListener("selectionchange", update);
			document.removeEventListener("pointerup", update);
			document.removeEventListener("touchend", update);
			document.removeEventListener("keydown", key);
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
		};
	}, [width]);
	if (!snapshot || (!onAttach && !onSaveAsNote)) return null;
	const quote = { messageId: snapshot.messageId, text: snapshot.text };
	const done = () => {
		setSnapshot(null);
		window.getSelection()?.removeAllRanges();
	};
	const action =
		"inline-flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg ring-2 ring-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
	return (
		<div
			ref={toolbar}
			role="toolbar"
			aria-label="Selection actions"
			className="fixed z-50 flex gap-2"
			style={{ left: snapshot.left, top: snapshot.top }}
			onPointerDown={(event) => {
				if (event.pointerType !== "touch") event.preventDefault();
			}}
		>
			{onAttach && (
				<button
					ref={button}
					type="button"
					className={action}
					onClick={() => {
						if (snapshot.text.length > REPLY_CONTEXT_LIMIT) {
							onTooLong();
							return;
						}
						onAttach(quote);
						done();
					}}
				>
					<Reply className="size-4" aria-hidden />
					Reply to selection
				</button>
			)}
			{onSaveAsNote && (
				<button
					ref={onAttach ? undefined : button}
					type="button"
					className={action}
					onClick={() => {
						onSaveAsNote(quote);
						done();
					}}
					data-testid="save-as-note"
				>
					<NotebookPen className="size-4" aria-hidden />
					Save as note
				</button>
			)}
		</div>
	);
}

/**
 * Asks which book a note saved from a multi-book conversation is for.
 * Choosing only opens the note editor; nothing is saved yet.
 */
export function SaveNoteBookDialog({
	books,
	onChoose,
	onCancel,
}: {
	/** The conversation's books; the dialog is open while this is non-null. */
	books: { editionId: string; title: string }[] | null;
	onChoose: (editionId: string) => void;
	onCancel: () => void;
}) {
	return (
		<Dialog
			open={books !== null}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<DialogContent data-testid="save-note-book">
				<DialogHeader>
					<DialogTitle>Save as a note on which book?</DialogTitle>
					<DialogDescription>
						The note opens for you to edit. Nothing is saved until you save it.
					</DialogDescription>
				</DialogHeader>
				<ul className="grid gap-2">
					{books?.map((b) => (
						<li key={b.editionId}>
							<Button
								type="button"
								variant="outline"
								className="w-full justify-start"
								onClick={() => onChoose(b.editionId)}
							>
								{b.title}
							</Button>
						</li>
					))}
				</ul>
			</DialogContent>
		</Dialog>
	);
}

export function ReplyQuote({ quote }: { quote: ReplyContext }) {
	return (
		<aside className="mb-2 border-l-2 pl-3 text-sm" data-testid="reply-quote">
			<p className="font-medium">Replying to assistant</p>
			<p className="whitespace-pre-wrap">{quote.text}</p>
		</aside>
	);
}
