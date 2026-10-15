import { describe, expect, it } from "vitest";
import {
	applyEdit,
	continueList,
	indentListItem,
	type TextState,
} from "./list-editing";

/** A state with the caret at `|` (removed from the text). */
function at(text: string): TextState {
	const caret = text.indexOf("|");
	return {
		value: text.replace("|", ""),
		selectionStart: caret,
		selectionEnd: caret,
	};
}

/** The text after an edit, with `|` marking the caret. */
function result(state: TextState, edit: ReturnType<typeof continueList>) {
	if (!edit) return null;
	const value = applyEdit(state.value, edit);
	return `${value.slice(0, edit.caret)}|${value.slice(edit.caret)}`;
}

const enter = (text: string) => {
	const state = at(text);
	return result(state, continueList(state));
};
const tab = (text: string, direction: 1 | -1) => {
	const state = at(text);
	return result(state, indentListItem(state, direction));
};

describe("continueList", () => {
	it("continues bullets and numbers at the same indentation", () => {
		expect(enter("- one|")).toBe("- one\n- |");
		expect(enter("* one|")).toBe("* one\n* |");
		expect(enter("1. He's hiding a breakdown|")).toBe(
			"1. He's hiding a breakdown\n2. |",
		);
		expect(enter("intro\n  9. nested|\nafter")).toBe(
			"intro\n  9. nested\n  10. |\nafter",
		);
	});

	it("ends the list on an empty item", () => {
		expect(enter("1. a\n2. |")).toBe("1. a\n|");
		expect(enter("- a\n  - |")).toBe("- a\n|");
	});

	it("leaves other newlines alone", () => {
		expect(enter("plain text|")).toBeNull();
		expect(enter("-not a list|")).toBeNull();
		expect(enter("1.5 is a number|")).toBeNull();
		expect(enter("- one| two")).toBeNull();
		expect(
			continueList({ value: "- one", selectionStart: 2, selectionEnd: 5 }),
		).toBeNull();
	});
});

describe("indentListItem", () => {
	it("indents and outdents a list item by two spaces", () => {
		expect(tab("- a\n- b|", 1)).toBe("- a\n  - b|");
		expect(tab("- a\n  - b|", -1)).toBe("- a\n- b|");
		expect(tab("1. x|y", 1)).toBe("  1. x|y");
		expect(tab("   - deep|", -1)).toBe(" - deep|");
	});

	it("keeps a top-level item in place on outdent", () => {
		expect(tab("- top|", -1)).toBe("- top|");
	});

	it("does nothing outside a list, so Tab moves focus", () => {
		expect(tab("plain|", 1)).toBeNull();
		expect(tab("plain|", -1)).toBeNull();
		expect(
			indentListItem(
				{ value: "- a\n- b", selectionStart: 0, selectionEnd: 7 },
				1,
			),
		).toBeNull();
	});
});
