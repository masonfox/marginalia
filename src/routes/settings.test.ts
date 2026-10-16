// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiStatus } from "#/modules/settings";
import type { AiSelection } from "#/server/config";
import { Route } from "./settings";

const mocks = vi.hoisted(() => ({
	status: vi.fn(),
	credentials: vi.fn(),
	models: vi.fn(),
	saveChat: vi.fn(),
	savePreprocess: vi.fn(),
	clearChat: vi.fn(),
	clearPreprocess: vi.fn(),
}));
vi.mock("#/fns/conversations", () => ({ getAiStatusFn: mocks.status }));
vi.mock("#/fns/settings", () => ({
	listModelsFn: mocks.models,
	listProviderCredentialsFn: mocks.credentials,
	saveProviderCredentialsFn: vi.fn(),
	removeProviderCredentialsFn: vi.fn(),
	saveChatDefaultFn: mocks.saveChat,
	savePreprocessDefaultFn: mocks.savePreprocess,
	clearChatDefaultFn: mocks.clearChat,
	clearPreprocessDefaultFn: mocks.clearPreprocess,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-start")>()),
	useServerFn: (fn: unknown) => fn,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const haiku: AiSelection = { provider: "anthropic", model: "claude-haiku" };
const gpt: AiSelection = { provider: "openai", model: "gpt-small" };

let status: AiStatus;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
	for (const m of Object.values(mocks)) m.mockReset();
	status = {
		enabled: true,
		providers: ["anthropic", "openai"],
		chat: { selection: haiku, available: true },
		preprocess: { selection: gpt, available: true, sameAsChat: false },
	};
	mocks.status.mockImplementation(async () => status);
	mocks.credentials.mockResolvedValue([]);
	mocks.models.mockResolvedValue({ models: [], error: null });
	mocks.saveChat.mockResolvedValue({ error: null });
	mocks.savePreprocess.mockResolvedValue({ error: null });
	mocks.clearPreprocess.mockImplementation(async () => {
		status = {
			...status,
			preprocess: { ...status.chat, sameAsChat: true },
		};
	});
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

async function mount() {
	container = document.createElement("div");
	document.body.append(container);
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	// The route loader fills these before the page renders.
	client.setQueryData(["ai-status"], status);
	client.setQueryData(["provider-credentials"], []);
	const Page = Route.options.component as ComponentType;
	await act(async () => {
		root = createRoot(container);
		root.render(
			createElement(QueryClientProvider, { client }, createElement(Page)),
		);
	});
}

const card = (label: string) => {
	const el = container.querySelector<HTMLElement>(
		`section[aria-label="${label}"]`,
	);
	if (!el) throw new Error(`No ${label} card`);
	return el;
};
const button = (scope: HTMLElement, text: string) => {
	const el = [...scope.querySelectorAll("button")].find(
		(b) => b.textContent === text,
	);
	if (!el) throw new Error(`No ${text} button`);
	return el;
};
const radio = (scope: HTMLElement, text: string) => {
	const label = [...scope.querySelectorAll("label")].find((l) =>
		l.textContent?.includes(text),
	);
	const input = label?.querySelector<HTMLInputElement>("input");
	if (!input) throw new Error(`No ${text} radio`);
	return input;
};
const provider = (scope: HTMLElement) => scope.querySelector("select");
const model = (scope: HTMLElement) =>
	scope.querySelector<HTMLInputElement>("input[list]");
/** Query observers are notified on a later tick. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = (el: HTMLElement) =>
	act(async () => {
		el.click();
		await tick();
	});
const type = (el: HTMLInputElement, value: string) =>
	act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(el, value);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
const refetch = () =>
	act(async () => {
		await client.invalidateQueries({ queryKey: ["ai-status"] });
		await tick();
	});

describe("Settings defaults", () => {
	it("clearing a specific preprocessing model resets the form to same as chat", async () => {
		await mount();
		const pre = card("Preprocessing default");
		expect(radio(pre, "A specific model").checked).toBe(true);
		expect(model(pre)?.value).toBe("gpt-small");
		await click(button(pre, "Clear"));
		await act(() =>
			vi.waitFor(() =>
				expect(pre.textContent).toContain(
					"Same as chat (Anthropic / claude-haiku)",
				),
			),
		);
		expect(radio(pre, "Same as the chat default").checked).toBe(true);
		expect(model(pre)).toBeNull();
		await click(button(pre, "Save preprocessing default"));
		expect(mocks.savePreprocess).toHaveBeenCalledWith({
			data: { selection: "same-as-chat" },
		});
	});

	it("a failed clear keeps the unsaved edits", async () => {
		mocks.clearPreprocess.mockRejectedValue(new Error("down"));
		await mount();
		const pre = card("Preprocessing default");
		const input = model(pre);
		if (!input) throw new Error("No model input");
		await type(input, "gpt-large");
		await click(button(pre, "Clear"));
		expect(pre.textContent).toContain("could not be saved");
		expect(radio(pre, "A specific model").checked).toBe(true);
		expect(model(pre)?.value).toBe("gpt-large");
	});

	it("an unrelated status reload keeps valid unsaved edits", async () => {
		await mount();
		const chat = card("Chat default");
		const pre = card("Preprocessing default");
		const chatInput = model(chat);
		const preInput = model(pre);
		if (!chatInput || !preInput) throw new Error("No model inputs");
		await type(chatInput, "claude-opus");
		await type(preInput, "gpt-large");
		await refetch();
		expect(model(chat)?.value).toBe("claude-opus");
		expect(model(pre)?.value).toBe("gpt-large");
	});

	it("removing a draft's provider resets only that draft", async () => {
		await mount();
		const chat = card("Chat default");
		const pre = card("Preprocessing default");
		const chatInput = model(chat);
		if (!chatInput) throw new Error("No model input");
		await type(chatInput, "claude-opus");
		status = {
			...status,
			providers: ["anthropic"],
			preprocess: { ...status.preprocess, available: false },
		};
		await refetch();
		// The chat draft's provider remains, so its edit is kept.
		expect(provider(chat)?.value).toBe("anthropic");
		expect(model(chat)?.value).toBe("claude-opus");
		// The preprocessing draft named the removed provider.
		expect(provider(pre)?.value).toBe("anthropic");
		expect(model(pre)?.value).toBe("");
		expect(button(pre, "Save preprocessing default").disabled).toBe(true);
	});

	it("removing the chat draft's provider resets it", async () => {
		status = {
			...status,
			chat: { selection: gpt, available: true },
			preprocess: { selection: gpt, available: true, sameAsChat: true },
		};
		await mount();
		const chat = card("Chat default");
		expect(provider(chat)?.value).toBe("openai");
		status = {
			...status,
			providers: ["anthropic"],
			chat: { selection: gpt, available: false },
			preprocess: { selection: gpt, available: false, sameAsChat: true },
		};
		await refetch();
		expect(provider(chat)?.value).toBe("anthropic");
		expect(model(chat)?.value).toBe("");
		expect(button(chat, "Save chat default").disabled).toBe(true);
	});
});

describe("Settings without providers", () => {
	const removed = (chat: AiSelection | null, own: AiSelection | null) => {
		status = {
			enabled: false,
			providers: [],
			chat: { selection: chat, available: false },
			preprocess: own
				? { selection: own, available: false, sameAsChat: false }
				: { selection: chat, available: false, sameAsChat: true },
		};
	};

	it("keeps saved defaults as unavailable summaries with clear actions", async () => {
		removed(haiku, gpt);
		mocks.clearChat.mockResolvedValue(undefined);
		await mount();
		expect(container.textContent).toContain("No AI provider is configured");
		const chat = card("Chat default");
		const pre = card("Preprocessing default");
		expect(chat.textContent).toContain("Current: Anthropic / claude-haiku");
		expect(chat.textContent).toContain("this default is unavailable");
		expect(pre.textContent).toContain("Current: OpenAI / gpt-small");
		expect(pre.textContent).toContain("this default is unavailable");
		expect(container.querySelector("select")).toBeNull();
		expect(container.querySelector("input")).toBeNull();
		expect(() => button(chat, "Save chat default")).toThrow();
		expect(() => button(pre, "Save preprocessing default")).toThrow();
		await click(button(chat, "Clear"));
		expect(mocks.clearChat).toHaveBeenCalled();
		await click(button(pre, "Clear"));
		expect(mocks.clearPreprocess).toHaveBeenCalled();
		expect(mocks.models).not.toHaveBeenCalled();
	});

	it("keeps a saved chat default followed by preprocessing", async () => {
		removed(haiku, null);
		await mount();
		expect(card("Chat default").textContent).toContain(
			"Anthropic / claude-haiku",
		);
		expect(card("Preprocessing default").textContent).toContain(
			"Same as chat (Anthropic / claude-haiku)",
		);
		expect(container.querySelector("select")).toBeNull();
	});

	it("a fresh instance only offers provider setup", async () => {
		removed(null, null);
		await mount();
		expect(container.textContent).toContain("No AI provider is configured");
		expect(
			container.querySelector('section[aria-label="Chat default"]'),
		).toBeNull();
		expect(
			container.querySelector('section[aria-label="Preprocessing default"]'),
		).toBeNull();
	});
});
