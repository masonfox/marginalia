// @vitest-environment jsdom
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitationRecord } from "#/modules/conversation";
import { AssistantText, citationIndex, numberCitations } from "./chat";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let phone = true;
const router = createRouter({
	routeTree: createRootRoute(),
	history: createMemoryHistory(),
});
const record: CitationRecord = {
	locator: "ab:v1:0.1",
	currentLocator: "ab:v1:0.1",
	quote: "Call me Ishmael.",
	status: "verified",
	editionId: "book1",
	bookTitle: "Moby-Dick",
	sectionTitle: "Loomings",
};
const text = 'A name [[cite locator="ab:v1:0.1" quote="Call me Ishmael."]]';

beforeEach(() => {
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: phone,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});
async function mount(citation: CitationRecord = record) {
	const citations = citationIndex([citation]);
	const remainingBookIds = new Set(["book1"]);
	const { numbers } = numberCitations([text], citations, remainingBookIds);
	await act(async () =>
		root.render(
			<RouterContextProvider router={router}>
				<AssistantText
					text={text}
					citations={citations}
					numbers={numbers}
					remainingBookIds={remainingBookIds}
				/>
			</RouterContextProvider>,
		),
	);
}
function trigger() {
	const button = container.querySelector<HTMLButtonElement>(
		"button[data-citation-status]",
	);
	if (!button) throw new Error("Citation trigger missing");
	return button;
}

describe("Citation presentation", () => {
	it("shows real verified quote text and opens a modal phone sheet that closes back to its marker", async () => {
		phone = true;
		await mount();
		expect(container.textContent).toContain(record.quote);
		const marker = trigger();
		await act(async () => marker.click());
		const sheet = document.querySelector<HTMLElement>('[role="dialog"]');
		expect(sheet?.getAttribute("aria-modal")).toBe("true");
		expect(sheet?.textContent).toContain(record.quote);
		const close = [...(sheet?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Close",
		);
		if (!close) throw new Error("Close control missing");
		await act(async () => close.click());
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(marker);
	});
	it("keeps unverified claims out of the inline book text", async () => {
		phone = true;
		await mount({
			...record,
			status: "quote_mismatch",
			currentLocator: null,
		});
		expect(container.textContent).not.toContain(record.quote);
		expect(trigger().getAttribute("data-citation-status")).toBe("unverified");
		await act(async () => trigger().click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"quote not found in that passage",
		);
	});
	it("keeps the desktop citation in an anchored popover", async () => {
		phone = false;
		await mount();
		await act(async () => trigger().click());
		const popover = document.querySelector<HTMLElement>('[role="dialog"]');
		expect(popover?.getAttribute("aria-modal")).toBeNull();
		expect(
			popover?.closest("[data-radix-popper-content-wrapper]"),
		).not.toBeNull();
		expect(popover?.textContent).toContain(record.quote);
	});
});
