// @vitest-environment jsdom
import { act } from "react";
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
import { captureReplySelection } from "./reply-selection";
import {
	ANCHOR_HIGHLIGHT,
	type MarkerThread,
	ThreadMarkers,
} from "./thread-markers";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** jsdom has no CSS Custom Highlight API; a stand-in records what is registered. */
class FakeHighlight {
	ranges: Range[];
	constructor(...ranges: Range[]) {
		this.ranges = ranges;
	}
}
const highlights = new Map<string, FakeHighlight>();

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	Object.assign(globalThis, { Highlight: FakeHighlight });
	Object.defineProperty(
		globalThis.CSS ?? Object.assign(globalThis, { CSS: {} }).CSS,
		"highlights",
		{
			value: highlights,
			configurable: true,
		},
	);
	// jsdom does no layout: every range is drawn in one box.
	Range.prototype.getClientRects = () =>
		[new DOMRect(10, 10, 100, 20)] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20);
});

const messageId = "11111111-1111-4111-8111-111111111111";
const thread = (
	id: string,
	anchorQuote: string,
	updatedAt = "2026-11-08T10:00:00Z",
): MarkerThread => ({
	id,
	anchorQuote,
	updatedAt,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	highlights.clear();
});

afterEach(() => {
	act(() => root.unmount());
	window.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
});

/** A rendered response with a citation pill, and its thread markers below it. */
const render = (threads: MarkerThread[], onOpen = vi.fn()) => {
	act(() =>
		root.render(
			<div data-message-id={messageId}>
				<div data-reply-source={messageId}>
					<p>
						Hal reads the <strong>dictionary</strong> because{" "}
						<button type="button" data-citation-status="verified">
							1
						</button>{" "}
						he wants words.
					</p>
					<p>A second paragraph follows.</p>
				</div>
				<ThreadMarkers
					messageId={messageId}
					threads={threads}
					onOpen={onOpen}
				/>
			</div>,
		),
	);
	return onOpen;
};

const chip = () => {
	const el = document.querySelector<HTMLButtonElement>(
		'[data-testid="thread-chip"]',
	);
	if (!el) throw new Error("no chip");
	return el;
};
const markers = () =>
	document.querySelector('[data-testid="thread-markers"]') as HTMLElement;
const registered = () => highlights.get(ANCHOR_HIGHLIGHT)?.ranges ?? [];

describe("thread chips", () => {
	it("opens the only thread from a one-thread chip", () => {
		const onOpen = render([thread("t1", "dictionary")]);
		expect(chip().textContent).toBe("1 thread");
		expect(chip().getAttribute("aria-label")).toBe("Open thread: dictionary");
		act(() => chip().click());
		expect(onOpen).toHaveBeenCalledWith("t1");
	});

	it("lists several threads by excerpt and recent activity, and opens the chosen one", async () => {
		const onOpen = render([
			thread("t1", "dictionary", "2026-11-01T10:00:00Z"),
			thread("t2", "he wants words", "2026-11-08T09:00:00Z"),
			thread("t3", "A second paragraph", "2026-11-05T09:00:00Z"),
		]);
		expect(chip().textContent).toBe("3 threads");
		chip().focus();
		await act(async () => {
			chip().dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		const items = [
			...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		];
		expect(items.map((i) => i.querySelector("span")?.textContent)).toEqual([
			"he wants words",
			"A second paragraph",
			"dictionary",
		]);
		await act(async () => items[1]?.click());
		expect(onOpen).toHaveBeenCalledWith("t3");
	});

	it("is excluded from selections and renders nothing without threads", () => {
		render([thread("t1", "dictionary")]);
		expect(markers().hasAttribute("data-reply-excluded")).toBe(true);
		render([]);
		expect(markers()).toBeNull();
	});
});

describe("anchor underlines", () => {
	it("underlines a quote matched across formatting and a citation pill", () => {
		render([thread("t1", "the dictionary because he\nwants")]);
		expect(markers().dataset.underlined).toBe("1");
		const [range] = registered();
		expect(range?.toString()).toBe("the dictionary because 1 he wants");
	});

	it("falls back to the chip alone when the quote is not in the displayed text", () => {
		render([thread("t1", "words that were never rendered")]);
		expect(markers().dataset.underlined).toBe("0");
		expect(registered()).toEqual([]);
		expect(chip().textContent).toBe("1 thread");
	});

	it("opens the thread on a click on the underline, but not after selecting text", () => {
		const onOpen = render([thread("t1", "dictionary")]);
		const text = document.querySelector("strong") as HTMLElement;
		act(() => {
			text.dispatchEvent(
				new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 15 }),
			);
		});
		expect(onOpen).toHaveBeenCalledWith("t1");
		onOpen.mockClear();
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(text);
		selection?.removeAllRanges();
		selection?.addRange(range);
		act(() => {
			text.dispatchEvent(
				new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 15 }),
			);
		});
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("leaves the response's text untouched, so selection and copy still work", () => {
		render([thread("t1", "dictionary because he wants")]);
		const source = document.querySelector("[data-reply-source]") as HTMLElement;
		expect(source.querySelectorAll("mark, [data-thread-anchor]")).toHaveLength(
			0,
		);
		const paragraph = source.querySelector("p") as HTMLElement;
		const range = document.createRange();
		range.selectNodeContents(paragraph);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		expect(captureReplySelection(selection, document.body)).toEqual({
			messageId,
			text: "Hal reads the dictionary because he wants words.",
		});
	});

	it("removes its underlines when unmounted", () => {
		render([thread("t1", "dictionary")]);
		expect(registered()).toHaveLength(1);
		act(() => root.render(<div />));
		expect(highlights.has(ANCHOR_HIGHLIGHT)).toBe(false);
	});
});
