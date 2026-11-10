// @vitest-environment jsdom
import { act, type RefObject } from "react";
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
import { REPLY_CONTEXT_LIMIT } from "#/lib/reply-context";
import { captureReplySelection, ReplySelection } from "./reply-selection";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const mainReply = "11111111-1111-4111-8111-111111111111";
const threadReply = "33333333-3333-4333-8333-333333333333";

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	// jsdom does no layout.
	Range.prototype.getBoundingClientRect = () => new DOMRect(100, 200, 50, 20);
});

let main: HTMLElement;
let panel: HTMLElement;
let host: HTMLDivElement;
let root: Root;

/**
 * A main conversation and a thread panel side by side, each a selection
 * surface with one assistant reply and one reader message.
 */
beforeEach(() => {
	document.body.innerHTML = `
		<main data-selection-scope>
			<div data-reply-source="${mainReply}"><p id="main-text">The main reply says something.</p></div>
			<p id="main-reader">A reader message.</p>
		</main>
		<aside data-selection-scope>
			<div data-reply-source="${threadReply}"><p id="thread-text">The thread reply goes deeper.</p></div>
			<p id="thread-reader">A reader message in the thread.</p>
		</aside>`;
	main = document.querySelector("main") as HTMLElement;
	panel = document.querySelector("aside") as HTMLElement;
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	window.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
});

const text = (id: string) => {
	const node = document.getElementById(id)?.firstChild;
	if (!node) throw new Error(`no text in #${id}`);
	return node;
};

/** Selects from an offset in one text node to an offset in another, then lets the toolbars react. */
function select(from: string, start: number, to: string, end: number) {
	const range = document.createRange();
	range.setStart(text(from), start);
	range.setEnd(text(to), end);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	act(() => {
		document.dispatchEvent(new Event("selectionchange"));
	});
}

const ref = (el: Element): RefObject<Element | null> => ({ current: el });

const labels = (surface: string) =>
	[
		...document.querySelectorAll(
			`[data-surface="${surface}"] [role="toolbar"] button`,
		),
	].map((b) => b.textContent);

function renderBoth(handlers: {
	onAttach?: () => void;
	onThread?: () => void;
	onBringToMain?: () => void;
	onReplyInThread?: () => void;
	onTooLong?: () => void;
}) {
	const noop = () => {};
	act(() =>
		root.render(
			<>
				<div data-surface="main">
					<ReplySelection
						container={ref(main)}
						onAttach={handlers.onAttach ?? noop}
						onThread={handlers.onThread ?? noop}
						onTooLong={handlers.onTooLong ?? noop}
						onSaveAsNote={noop}
					/>
				</div>
				<div data-surface="thread">
					<ReplySelection
						container={ref(panel)}
						onAttach={handlers.onReplyInThread ?? noop}
						onBringToMain={handlers.onBringToMain ?? noop}
						onTooLong={handlers.onTooLong ?? noop}
						onSaveAsNote={noop}
					/>
				</div>
			</>,
		),
	);
}

const button = (surface: string, label: string) => {
	const found = [
		...document.querySelectorAll<HTMLButtonElement>(
			`[data-surface="${surface}"] [role="toolbar"] button`,
		),
	].find((b) => b.textContent === label);
	if (!found) throw new Error(`no ${label} in ${surface}`);
	return found;
};

describe("ReplySelection", () => {
	it("offers Reply, Thread, and Note in the main conversation only", () => {
		renderBoth({});
		select("main-text", 4, "main-text", 14);
		expect(labels("main")).toEqual([
			"Reply to selection",
			"Thread",
			"Save as note",
		]);
		expect(labels("thread")).toEqual([]);
	});

	it("offers Reply, Bring to main, and Note in a thread only", () => {
		renderBoth({});
		select("thread-text", 4, "thread-text", 16);
		expect(labels("thread")).toEqual([
			"Reply to selection",
			"Bring to main",
			"Save as note",
		]);
		expect(labels("main")).toEqual([]);
	});

	it("passes the selected quote to Thread and Bring to main", () => {
		const onThread = vi.fn();
		const onBringToMain = vi.fn();
		renderBoth({ onThread, onBringToMain });
		select("main-text", 4, "main-text", 14);
		act(() => button("main", "Thread").click());
		expect(onThread).toHaveBeenCalledWith({
			messageId: mainReply,
			text: "main reply",
		});
		expect(labels("main")).toEqual([]);
		select("thread-text", 4, "thread-text", 16);
		act(() => button("thread", "Bring to main").click());
		expect(onBringToMain).toHaveBeenCalledWith({
			messageId: threadReply,
			text: "thread reply",
		});
	});

	it("offers nothing for a selection that crosses the panel boundary", () => {
		renderBoth({});
		select("main-text", 4, "thread-text", 10);
		expect(labels("main")).toEqual([]);
		expect(labels("thread")).toEqual([]);
		select("thread-text", 4, "main-text", 0);
		expect(labels("main")).toEqual([]);
		expect(labels("thread")).toEqual([]);
	});

	it("offers nothing for a reader message", () => {
		renderBoth({});
		select("main-reader", 0, "main-reader", 8);
		select("thread-reader", 0, "thread-reader", 8);
		expect(labels("main")).toEqual([]);
		expect(labels("thread")).toEqual([]);
	});

	it("explains an over-limit selection instead of starting a thread", () => {
		const long = "x".repeat(REPLY_CONTEXT_LIMIT + 1);
		const node = text("main-text");
		node.textContent = long;
		const onThread = vi.fn();
		const onTooLong = vi.fn();
		renderBoth({ onThread, onTooLong });
		select("main-text", 0, "main-text", long.length);
		act(() => button("main", "Thread").click());
		expect(onThread).not.toHaveBeenCalled();
		expect(onTooLong).toHaveBeenCalledOnce();
	});
});

describe("captureReplySelection", () => {
	it("ignores a selection inside a surface nested in the container", () => {
		// The panel moves inside the main conversation, as a drawer might.
		main.append(panel);
		select("thread-text", 4, "thread-text", 16);
		const selection = window.getSelection();
		expect(captureReplySelection(selection, main)).toBeNull();
		expect(captureReplySelection(selection, panel)).toEqual({
			messageId: threadReply,
			text: "thread reply",
		});
		select("main-text", 4, "main-text", 14);
		expect(captureReplySelection(window.getSelection(), main)).toEqual({
			messageId: mainReply,
			text: "main reply",
		});
	});

	it("captures nothing without a container", () => {
		select("main-text", 4, "main-text", 14);
		expect(captureReplySelection(window.getSelection(), null)).toBeNull();
	});
});
