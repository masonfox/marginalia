import { useEffect, useRef, useState } from "react";
import { REPLY_CONTEXT_LIMIT, type ReplyContext } from "#/modules/conversation";

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
		if (element?.closest("[data-reply-excluded],button,a,input,textarea"))
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
	const text = selection.toString().trim();
	return text ? { messageId, text } : null;
}

export function ReplySelection({
	onAttach,
}: {
	onAttach: (quote: ReplyContext) => void;
}) {
	const [snapshot, setSnapshot] = useState<
		(ReplyContext & { left: number; top: number }) | null
	>(null);
	const [feedback, setFeedback] = useState("");
	const button = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const update = (event?: Event) => {
			if (
				document.activeElement === button.current &&
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
				left: Math.max(8, Math.min(rect.left, window.innerWidth - 180)),
				top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 48)),
			});
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setSnapshot(null);
				setFeedback("");
			}
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
	}, []);
	return (
		<>
			{snapshot && (
				<button
					ref={button}
					type="button"
					className="fixed z-50 rounded-md border bg-popover px-3 py-2 text-sm shadow-md"
					style={{ left: snapshot.left, top: snapshot.top }}
					onPointerDown={(event) => {
						if (event.pointerType !== "touch") event.preventDefault();
					}}
					onClick={() => {
						if (snapshot.text.length > REPLY_CONTEXT_LIMIT) {
							setFeedback(
								"Select at most 2,000 characters to reply. Your existing quote is unchanged.",
							);
							return;
						}
						onAttach({ messageId: snapshot.messageId, text: snapshot.text });
						setSnapshot(null);
						setFeedback("");
						window.getSelection()?.removeAllRanges();
					}}
				>
					Reply to selection
				</button>
			)}
			<output aria-live="polite" className="text-sm text-muted-foreground">
				{feedback}
			</output>
		</>
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
