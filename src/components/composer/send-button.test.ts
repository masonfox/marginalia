// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockedReason, SendButton } from "./send-button";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("blockedReason", () => {
	it("asks for a message first, then waits for a passage check", () => {
		expect(blockedReason({ draft: "", checking: false })).toBe(
			"Type a message",
		);
		expect(blockedReason({ draft: " \n\t", checking: true })).toBe(
			"Type a message",
		);
		expect(blockedReason({ draft: "Why?", checking: true })).toBe(
			"Checking passage…",
		);
		expect(blockedReason({ draft: "Why?", checking: false })).toBeNull();
	});
});

describe("SendButton", () => {
	let root: ReturnType<typeof createRoot>;
	let container: HTMLDivElement;

	function render(props: Parameters<typeof SendButton>[0]) {
		container = document.createElement("div");
		document.body.append(container);
		act(() => {
			root = createRoot(container);
			root.render(createElement(SendButton, props));
		});
		const button = container.querySelector("button");
		if (!button) throw new Error("no button rendered");
		return button;
	}

	/** Clicks the button and reports whether the click was default-prevented. */
	function click(button: HTMLButtonElement) {
		const event = new MouseEvent("click", { bubbles: true, cancelable: true });
		act(() => {
			button.dispatchEvent(event);
		});
		return event.defaultPrevented;
	}

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("shows Stop while busy, and stopping calls onStop once", () => {
		const onStop = vi.fn();
		const button = render({ busy: true, reason: null, onStop });
		expect(button.getAttribute("aria-label")).toBe("Stop");
		expect(button.type).toBe("button");
		click(button);
		expect(onStop).toHaveBeenCalledTimes(1);
	});

	it("shows a blocked Send that explains why and swallows the click", () => {
		const onStop = vi.fn();
		const button = render({
			busy: false,
			reason: "Type a message",
			onStop,
		});
		expect(button.getAttribute("aria-label")).toBe("Send");
		expect(button.getAttribute("aria-disabled")).toBe("true");
		const describedBy = button.getAttribute("aria-describedby");
		expect(describedBy).toBeTruthy();
		expect(container.querySelector(`[id="${describedBy}"]`)?.textContent).toBe(
			"Type a message",
		);
		expect(click(button)).toBe(true);
		expect(onStop).not.toHaveBeenCalled();
	});

	it("shows an enabled submit Send when nothing blocks it", () => {
		const button = render({ busy: false, reason: null, onStop: vi.fn() });
		expect(button.getAttribute("aria-label")).toBe("Send");
		expect(button.type).toBe("submit");
		expect(button.disabled).toBe(false);
		expect(button.hasAttribute("aria-disabled")).toBe(false);
		expect(button.hasAttribute("aria-describedby")).toBe(false);
	});
});
