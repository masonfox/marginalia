// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiDefault, AiStatus } from "#/modules/settings";
import type { AiProviderName, AiSelection } from "#/server/config";
import { modelInEffect } from "./chat";
import { ConversationModelControl } from "./conversation-controls";

const mocks = vi.hoisted(() => ({
	set: vi.fn(),
	models: vi.fn(),
	invalidate: vi.fn(),
}));
vi.mock("#/fns/conversations", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/fns/conversations")>()),
	setConversationModelFn: mocks.set,
}));
vi.mock("#/fns/settings", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/fns/settings")>()),
	listModelsFn: mocks.models,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-start")>()),
	useServerFn: (fn: unknown) => fn,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useRouter: () => ({ invalidate: mocks.invalidate }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const conversationId = "00000000-0000-4000-8000-000000000001";
const haiku: AiSelection = { provider: "anthropic", model: "claude-haiku" };
const gpt: AiSelection = { provider: "openai", model: "gpt-small" };

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeEach(() => {
	mocks.set.mockReset();
	mocks.set.mockResolvedValue({ status: "ok" });
	mocks.models.mockResolvedValue({ models: [], error: null });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	document.body.innerHTML = "";
});

async function mount({
	providers,
	chat,
	own,
	disabled = false,
}: {
	providers: AiProviderName[];
	chat: AiDefault;
	own: AiSelection | null;
	disabled?: boolean;
}) {
	const status: AiStatus = {
		enabled: providers.length > 0,
		providers,
		chat,
		preprocess: { ...chat, sameAsChat: true },
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(ConversationModelControl, {
					conversationId,
					status,
					own,
					effect: modelInEffect(status, own),
					disabled,
					open: true,
					onOpenChange: () => {},
				}),
			),
		);
	});
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (text: string) => {
	const el = [...(dialog()?.querySelectorAll("button") ?? [])].find(
		(b) => b.textContent === text,
	);
	if (!el) throw new Error(`No ${text} button`);
	return el;
};
const click = (el: HTMLElement) => act(async () => el.click());

describe("ConversationModelControl clearing", () => {
	it.each([
		["missing", { selection: null, available: false }],
		["unavailable", { selection: gpt, available: false }],
	] as const)("clears a working own model when the default is %s", async (_, chat) => {
		await mount({ providers: ["anthropic"], chat, own: haiku });
		expect(button("Save").disabled).toBe(true);
		await click(button("Use the default"));
		expect(dialog()?.textContent).toContain(
			"this conversation will have no usable model",
		);
		expect(button("Save").disabled).toBe(false);
		await click(button("Save"));
		expect(mocks.set).toHaveBeenCalledWith({
			data: { conversationId, selection: null },
		});
	});

	it("clears an unavailable own model when the default is missing", async () => {
		await mount({
			providers: ["anthropic"],
			chat: { selection: null, available: false },
			own: gpt,
		});
		expect(dialog()?.textContent).not.toContain("Use default (");
		await click(button("Use the default"));
		expect(dialog()?.textContent).toContain("No chat default is set");
		await click(button("Save"));
		expect(mocks.set).toHaveBeenCalledWith({
			data: { conversationId, selection: null },
		});
	});

	it("an unchanged default selection stays unsavable", async () => {
		await mount({
			providers: ["anthropic"],
			chat: { selection: null, available: false },
			own: null,
		});
		expect(() => button("Use the default")).toThrow();
		expect(button("Save").disabled).toBe(true);
	});

	it("keeps the dialog closed while a reply streams", async () => {
		await mount({
			providers: ["anthropic"],
			chat: { selection: null, available: false },
			own: haiku,
			disabled: true,
		});
		expect(dialog()).toBeNull();
		const change = [...container.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Change model"),
		);
		expect(change?.disabled).toBe(true);
	});
});

describe("ConversationModelControl without providers", () => {
	it("names the unavailable own model and offers only clearing it", async () => {
		await mount({
			providers: [],
			chat: { selection: gpt, available: false },
			own: haiku,
		});
		expect(container.textContent).toContain(
			"Anthropic / claude-haiku (unavailable)",
		);
		expect(dialog()?.textContent).toContain("No AI provider is configured");
		expect(dialog()?.querySelector("select")).toBeNull();
		await click(button("Use the default"));
		await click(button("Save"));
		expect(mocks.set).toHaveBeenCalledWith({
			data: { conversationId, selection: null },
		});
		expect(mocks.models).not.toHaveBeenCalled();
	});

	it("shows nothing on a fresh instance", async () => {
		await mount({
			providers: [],
			chat: { selection: null, available: false },
			own: null,
		});
		expect(container.textContent).toBe("");
		expect(dialog()).toBeNull();
	});
});
