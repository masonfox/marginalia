import { cn } from "cn";
import {
	type ComponentProps,
	type KeyboardEvent,
	type Ref,
	useLayoutEffect,
	useRef,
} from "react";
import {
	applyEdit,
	continueList,
	indentListItem,
	type TextEdit,
} from "#/lib/list-editing";

/** The tallest the input grows, as a share of the viewport. */
const MAX_HEIGHT_SHARE = 0.4;

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
 */
export function AutogrowTextarea({
	value,
	onValueChange,
	onKeyDown,
	className,
	ref,
	...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
	value: string;
	onValueChange: (value: string) => void;
	ref?: Ref<HTMLTextAreaElement>;
}) {
	const own = useRef<HTMLTextAreaElement | null>(null);
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
		if (supportsFieldSizing()) return;
		el.style.height = "auto";
		const max = window.innerHeight * MAX_HEIGHT_SHARE;
		const border = el.offsetHeight - el.clientHeight;
		el.style.height = `${Math.min(el.scrollHeight + border, max)}px`;
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
			className={cn(
				"block max-h-[40dvh] resize-none overflow-y-auto [field-sizing:content]",
				className,
			)}
		/>
	);
}
