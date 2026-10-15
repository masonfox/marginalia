/** A textarea's text and selection. */
export interface TextState {
	value: string;
	selectionStart: number;
	selectionEnd: number;
}

/** Replace `[replaceStart, replaceEnd)` with `insert`, then put the caret at `caret`. */
export interface TextEdit {
	replaceStart: number;
	replaceEnd: number;
	insert: string;
	caret: number;
}

/** A list item: indentation, then `- `, `* `, or `N. `. */
const ITEM = /^([ \t]*)(?:([-*])|(\d{1,9})\.) (.*)$/;
const INDENT = "  ";

function lineAt(value: string, at: number) {
	const start = value.lastIndexOf("\n", at - 1) + 1;
	const newline = value.indexOf("\n", at);
	const end = newline === -1 ? value.length : newline;
	return { start, end, text: value.slice(start, end) };
}

/**
 * A newline at the end of a list item starts the next item at the same
 * indentation, numbered one higher. On an item with no content, it removes the
 * marker and ends the list instead. Returns null where a plain newline applies.
 */
export function continueList({
	value,
	selectionStart,
	selectionEnd,
}: TextState): TextEdit | null {
	if (selectionStart !== selectionEnd) return null;
	const line = lineAt(value, selectionStart);
	if (selectionStart !== line.end) return null;
	const match = ITEM.exec(line.text);
	if (!match) return null;
	const [, indent = "", bullet, number, content = ""] = match;
	if (!content.trim())
		return {
			replaceStart: line.start,
			replaceEnd: line.end,
			insert: "",
			caret: line.start,
		};
	const marker = bullet ?? `${Number(number) + 1}.`;
	const insert = `\n${indent}${marker} `;
	return {
		replaceStart: selectionStart,
		replaceEnd: selectionStart,
		insert,
		caret: selectionStart + insert.length,
	};
}

/**
 * Indents (`1`) or outdents (`-1`) the list item at the caret by two spaces.
 * Returns null when the caret is not on a single list item, so Tab moves focus.
 * Outdenting an item that has no indentation changes nothing but still applies.
 */
export function indentListItem(
	{ value, selectionStart, selectionEnd }: TextState,
	direction: 1 | -1,
): TextEdit | null {
	const line = lineAt(value, selectionStart);
	if (selectionEnd > line.end || !ITEM.test(line.text)) return null;
	if (direction === 1)
		return {
			replaceStart: line.start,
			replaceEnd: line.start,
			insert: INDENT,
			caret: selectionStart + INDENT.length,
		};
	const removed = /^ {0,2}/.exec(line.text)?.[0].length ?? 0;
	return {
		replaceStart: line.start,
		replaceEnd: line.start + removed,
		insert: "",
		caret: Math.max(line.start, selectionStart - removed),
	};
}

/** Applies an edit to plain text, for callers that cannot edit in place. */
export function applyEdit(value: string, edit: TextEdit): string {
	return (
		value.slice(0, edit.replaceStart) +
		edit.insert +
		value.slice(edit.replaceEnd)
	);
}
