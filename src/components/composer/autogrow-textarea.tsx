import { cn } from "cn";
import {
	type ComponentProps,
	type KeyboardEvent,
	type Ref,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import {
	applyEdit,
	continueList,
	indentListItem,
	type TextEdit,
} from "#/lib/list-editing";
import {
	highlightMarkdown,
	type MarkdownStyle,
} from "#/lib/markdown-highlight";

/** The tallest the input grows, as a share of the viewport. */
const MAX_HEIGHT_SHARE = 0.4;

/**
 * How each Markdown style is drawn. Nothing here may change glyph widths, or
 * the drawn text drifts from the caret: weight is faked with a stroke, and
 * there is no italic, size change, or monospace.
 */
const STYLE_CLASSES: Record<MarkdownStyle, string> = {
	marker: "text-muted-foreground",
	heading: "[-webkit-text-stroke:0.04em_currentColor]",
	strong: "[-webkit-text-stroke:0.035em_currentColor]",
	em: "",
	strike: "line-through",
	code: "rounded-sm bg-foreground/[0.07]",
	link: "underline underline-offset-2",
	url: "text-muted-foreground",
	quote: "text-muted-foreground",
};

/** The draft with its Markdown styled, laid out exactly like the input's text. */
function Highlight({ value }: { value: string }) {
	const segments = useMemo(() => highlightMarkdown(value), [value]);
	return segments.map((segment, i) => (
		<span
			// biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond their order
			key={i}
			className={cn(segment.styles.map((style) => STYLE_CLASSES[style]))}
		>
			{segment.text}
		</span>
	));
}

const supportsFieldSizing = () =>
	typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

/**
 * Applies an edit in place so it joins the browser's undo history; where that
 * is unsupported, sets the value instead and loses undo for the edit.
 */
function applyTextEdit(
	el: HTMLTextAreaElement,
	edit: TextEdit,
	setValue: (value: string) => void,
	setCaret: (caret: number) => void,
) {
	if (edit.insert === "" && edit.replaceStart === edit.replaceEnd) {
		el.setSelectionRange(edit.caret, edit.caret);
		return;
	}
	el.setSelectionRange(edit.replaceStart, edit.replaceEnd);
	const applied = edit.insert
		? document.execCommand("insertText", false, edit.insert)
		: document.execCommand("delete");
	if (applied) {
		el.setSelectionRange(edit.caret, edit.caret);
		return;
	}
	setCaret(edit.caret);
	setValue(applyEdit(el.value, edit));
}

/**
 * A plain-text input that grows with its content from one line up to about
 * 40% of the viewport, then scrolls. Enter and Tab continue and indent
 * Markdown lists unless `onKeyDown` has already handled the key.
 *
 * The text stays plain but is drawn with its Markdown styled: the textarea's
 * own text is transparent, and a copy laid out identically sits over it.
 * `className` applies to both, so it should set only padding and type;
 * `containerClassName` places the field.
 */
export function AutogrowTextarea({
	value,
	onValueChange,
	onKeyDown,
	onScroll,
	className,
	containerClassName,
	ref,
	...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
	value: string;
	onValueChange: (value: string) => void;
	containerClassName?: string;
	ref?: Ref<HTMLTextAreaElement>;
}) {
	const own = useRef<HTMLTextAreaElement | null>(null);
	const overlay = useRef<HTMLDivElement>(null);
	const caret = useRef<number | null>(null);

	// Where `field-sizing` is unsupported (Firefox), size to the content by hand.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resize when the text changes
	useLayoutEffect(() => {
		const el = own.current;
		if (!el) return;
		if (caret.current !== null) {
			el.setSelectionRange(caret.current, caret.current);
			caret.current = null;
		}
		if (!supportsFieldSizing()) {
			el.style.height = "auto";
			const max = window.innerHeight * MAX_HEIGHT_SHARE;
			const border = el.offsetHeight - el.clientHeight;
			el.style.height = `${Math.min(el.scrollHeight + border, max)}px`;
		}
		if (overlay.current) overlay.current.scrollTop = el.scrollTop;
	}, [value]);

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		onKeyDown?.(e);
		if (e.defaultPrevented || e.nativeEvent.isComposing) return;
		const el = e.currentTarget;
		const state = {
			value: el.value,
			selectionStart: el.selectionStart,
			selectionEnd: el.selectionEnd,
		};
		let edit: TextEdit | null = null;
		if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey)
			edit = continueList(state);
		else if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey)
			edit = indentListItem(state, e.shiftKey ? -1 : 1);
		if (!edit) return;
		e.preventDefault();
		applyTextEdit(el, edit, onValueChange, (at) => {
			caret.current = at;
		});
	};

	return (
		<div className={cn("relative", containerClassName)}>
			<textarea
				{...props}
				ref={(el) => {
					own.current = el;
					if (typeof ref === "function") ref(el);
					else if (ref) ref.current = el;
				}}
				rows={1}
				value={value}
				onChange={(e) => onValueChange(e.target.value)}
				onKeyDown={handleKeyDown}
				onScroll={(e) => {
					onScroll?.(e);
					if (overlay.current)
						overlay.current.scrollTop = e.currentTarget.scrollTop;
				}}
				className={cn(
					"block max-h-[40dvh] w-full resize-none overflow-y-auto bg-transparent text-transparent caret-foreground outline-none [field-sizing:content] [scrollbar-gutter:stable] placeholder:text-muted-foreground selection:text-transparent",
					className,
				)}
			/>
			<div
				ref={overlay}
				aria-hidden
				data-testid="composer-highlight"
				className={cn(
					"pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words [scrollbar-gutter:stable]",
					className,
				)}
			>
				<Highlight value={value} />
				{/* Gives a trailing newline its own line, as the textarea does. */}
				{"​"}
			</div>
		</div>
	);
}
