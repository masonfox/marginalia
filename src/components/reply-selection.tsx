import { CornerUpLeft, MessagesSquare, NotebookPen, Reply } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
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

/**
 * Marks a chat surface's container (the main conversation or a thread panel).
 * Selection capture belongs to the nearest marked container, so a nested
 * surface's selections never reach the one around it.
 */
export const SELECTION_SCOPE_ATTRIBUTE = "data-selection-scope";

/**
 * The selected text of one saved assistant response inside `container`.
 * Inspects every intersected subtree, including controls between text
 * endpoints. A selection reaching outside the container, or into another
 * surface nested in it, is ineligible.
 */
export function captureReplySelection(
	selection: Selection | null,
	container: Element | null,
): ReplyContext | null {
	if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
		return null;
	if (!container) return null;
	const range = selection.getRangeAt(0);
	const ancestor = range.commonAncestorContainer;
	if (!container.contains(ancestor)) return null;
	const elementOf = (node: Node) =>
		node.nodeType === Node.ELEMENT_NODE
			? (node as Element)
			: node.parentElement;
	const scope = `[${SELECTION_SCOPE_ATTRIBUTE}]`;
	// The nearest surface around the selection must be this one.
	const nearest = elementOf(ancestor)?.closest(scope);
	if (nearest && nearest !== container && container.contains(nearest))
		return null;
	const rootOf = (node: Node) =>
		elementOf(node)?.closest<HTMLElement>("[data-reply-source]");
	const first = rootOf(range.startContainer);
	const last = rootOf(range.endContainer);
	const messageId = first?.dataset.replySource;
	if (!messageId || messageId !== last?.dataset.replySource) return null;
	const walker = document.createTreeWalker(
		ancestor,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
	);
	const valid = (node: Node) => {
		if (!range.intersectsNode(node)) return true;
		if (elementOf(node)?.closest("[data-reply-excluded],input,textarea"))
			return false;
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

/** One selection action, in toolbar order. */
interface SelectionAction {
	label: string;
	icon: typeof Reply;
	testId: string;
	/** Over-limit selections show the quote-limit explanation instead. */
	limited: boolean;
	run: (quote: ReplyContext) => void;
}

export function ReplySelection({
	container,
	onAttach,
	onThread,
	onBringToMain,
	onTooLong,
	onSaveAsNote,
}: {
	/**
	 * This surface's container, marked with `data-selection-scope`. Only
	 * selections wholly inside it, and not inside a surface nested in it, are
	 * offered actions.
	 */
	container: RefObject<Element | null>;
	/** Replies to the selection; absent when replies cannot be sent. */
	onAttach?: (quote: ReplyContext) => void;
	/** Starts a side thread on the selection; offered only in the main conversation. */
	onThread?: (quote: ReplyContext) => void;
	/** Quotes the selection in the main composer; offered only inside a thread. */
	onBringToMain?: (quote: ReplyContext) => void;
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
	const actions: SelectionAction[] = [];
	if (onAttach)
		actions.push({
			label: "Reply to selection",
			icon: Reply,
			testId: "reply-to-selection",
			limited: true,
			run: onAttach,
		});
	if (onThread)
		actions.push({
			label: "Thread",
			icon: MessagesSquare,
			testId: "thread-selection",
			limited: true,
			run: onThread,
		});
	if (onBringToMain)
		actions.push({
			label: "Bring to main",
			icon: CornerUpLeft,
			testId: "bring-to-main",
			limited: true,
			run: onBringToMain,
		});
	if (onSaveAsNote)
		actions.push({
			label: "Save as note",
			icon: NotebookPen,
			testId: "save-as-note",
			limited: false,
			run: onSaveAsNote,
		});
	const width = Math.max(180, actions.length * 170);
	useEffect(() => {
		const update = (event?: Event) => {
			if (
				toolbar.current?.contains(document.activeElement) &&
				event?.type === "selectionchange"
			)
				return;
			const selection = window.getSelection();
			const quote = captureReplySelection(selection, container.current);
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
				captureReplySelection(window.getSelection(), container.current)
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
	}, [width, container]);
	if (!snapshot || actions.length === 0) return null;
	const quote = { messageId: snapshot.messageId, text: snapshot.text };
	const done = () => {
		setSnapshot(null);
		window.getSelection()?.removeAllRanges();
	};
	const style =
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
			{actions.map(({ label, icon: Icon, testId, limited, run }, index) => (
				<button
					key={testId}
					ref={index === 0 ? button : undefined}
					type="button"
					className={style}
					onClick={() => {
						if (limited && snapshot.text.length > REPLY_CONTEXT_LIMIT) {
							onTooLong();
							return;
						}
						run(quote);
						done();
					}}
					data-testid={testId}
				>
					<Icon className="size-4" aria-hidden />
					{label}
				</button>
			))}
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

/**
 * A sent message's quote of an assistant response. A quote brought from a
 * thread says so, with a control that opens the thread.
 */
export function ReplyQuote({
	quote,
	onOpenThread,
}: {
	quote: ReplyContext;
	/** Present when the quoted reply is in a thread: opens that thread. */
	onOpenThread?: () => void;
}) {
	return (
		<aside className="mb-2 border-l-2 pl-3 text-sm" data-testid="reply-quote">
			<p className="font-medium">
				{onOpenThread ? (
					<>
						Replying to assistant{" "}
						<span data-testid="quote-from-thread">from a thread</span> ·{" "}
						<button
							type="button"
							className="cursor-pointer rounded-sm font-medium text-amber-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
							onClick={onOpenThread}
						>
							Open thread
						</button>
					</>
				) : (
					"Replying to assistant"
				)}
			</p>
			<p className="whitespace-pre-wrap">{quote.text}</p>
		</aside>
	);
}
