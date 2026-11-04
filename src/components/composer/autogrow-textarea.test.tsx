// @vitest-environment jsdom
import { act, type KeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { AutogrowTextarea } from "./autogrow-textarea";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
/** Refuses every in-place edit, so the handler takes its fallback. */
let execCommand: ReturnType<typeof vi.fn>;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	execCommand = vi.fn(() => false);
	Object.defineProperty(document, "execCommand", {
		configurable: true,
		value: execCommand,
	});
});

afterEach(() => {
	act(() => root.unmount());
	document.body.replaceChildren();
	Reflect.deleteProperty(document, "execCommand");
});

/** Renders a controlled field that reflects every change it reports. */
function renderField(
	initial: string,
	props: {
		readOnly?: boolean;
		disabled?: boolean;
		onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
	} = {},
) {
	const onValueChange = vi.fn();
	const draw = (value: string) =>
		root.render(
			<AutogrowTextarea
				{...props}
				aria-label="field"
				value={value}
				onValueChange={(next) => {
					onValueChange(next);
					draw(next);
				}}
			/>,
		);
	act(() => draw(initial));
	const el = container.querySelector("textarea");
	if (!el) throw new Error("no textarea");
	el.setSelectionRange(initial.length, initial.length);
	return { el, onValueChange };
}

/** Dispatches a key and reports whether anything prevented its default. */
const press = (
	el: HTMLTextAreaElement,
	key: string,
	init: KeyboardEventInit = {},
) => {
	const event = new window.KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	});
	act(() => {
		el.dispatchEvent(event);
	});
	return event.defaultPrevented;
};

describe("AutogrowTextarea list editing", () => {
	it("indents, outdents, and continues a list when editable", () => {
		const tab = renderField("- a");
		expect(press(tab.el, "Tab")).toBe(true);
		expect(tab.onValueChange).toHaveBeenLastCalledWith("  - a");
		expect(tab.el.value).toBe("  - a");

		const outdent = renderField("  - a");
		expect(press(outdent.el, "Tab", { shiftKey: true })).toBe(true);
		expect(outdent.onValueChange).toHaveBeenLastCalledWith("- a");

		const enter = renderField("- a");
		expect(press(enter.el, "Enter")).toBe(true);
		expect(enter.onValueChange).toHaveBeenLastCalledWith("- a\n- ");

		const shiftEnter = renderField("- a");
		expect(press(shiftEnter.el, "Enter", { shiftKey: true })).toBe(true);
		expect(shiftEnter.onValueChange).toHaveBeenLastCalledWith("- a\n- ");
		expect(execCommand).toHaveBeenCalled();
	});

	describe.each([
		["read-only", { readOnly: true }],
		["disabled", { disabled: true }],
	])("when %s", (_, lock) => {
		it.each([
			["Tab", "- a", "Tab", {}],
			["Shift+Tab on an indented item", "  - a", "Tab", { shiftKey: true }],
			["Enter", "- a", "Enter", {}],
			["Shift+Enter", "- a", "Enter", { shiftKey: true }],
		])("leaves the text alone on %s", (_, text, key, init) => {
			const onKeyDown = vi.fn();
			const { el, onValueChange } = renderField(text, { ...lock, onKeyDown });
			expect(press(el, key, init)).toBe(false);
			expect(onKeyDown).toHaveBeenCalledTimes(1);
			expect(onValueChange).not.toHaveBeenCalled();
			expect(execCommand).not.toHaveBeenCalled();
			expect(el.value).toBe(text);
			expect([el.selectionStart, el.selectionEnd]).toEqual([
				text.length,
				text.length,
			]);
		});
	});

	it("leaves a key the parent handled to the parent", () => {
		const { el, onValueChange } = renderField("- a", {
			onKeyDown: (e) => e.preventDefault(),
		});
		expect(press(el, "Enter")).toBe(true);
		expect(onValueChange).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it("leaves keys alone while an IME is composing", () => {
		const { el, onValueChange } = renderField("- a");
		expect(press(el, "Enter", { isComposing: true })).toBe(false);
		expect(onValueChange).not.toHaveBeenCalled();
	});
});
