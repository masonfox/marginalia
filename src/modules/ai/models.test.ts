import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { priceFor, priceTable } from "#/modules/usage";
import type { AiCredentials } from "#/server/config";
import {
	clearModelListCache,
	clearSecrets,
	listModels,
	MODEL_LIST_TTL_MS,
} from "./index";

type Call = { url: string; headers: Headers; signal?: AbortSignal | null };

/** Stubs fetch with one handler per request, in order, recording each call. */
function stubFetch(
	...replies: ((url: string) => Response | Promise<Response>)[]
) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			calls.push({
				url: String(url),
				headers: new Headers(init?.headers),
				signal: init?.signal,
			});
			const reply = replies[Math.min(calls.length, replies.length) - 1];
			if (!reply) throw new Error("unexpected request");
			return reply(String(url));
		}),
	);
	return calls;
}

const json = (body: unknown) => () => Response.json(body);
const key = (apiKey: string, baseUrl?: string): AiCredentials => ({
	apiKey,
	baseUrl,
});

beforeEach(() => clearModelListCache());
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	clearSecrets();
});

describe("listModels", () => {
	it("lists OpenAI models with the key and known prices", async () => {
		const calls = stubFetch(
			json({ data: [{ id: "gpt-x" }, { id: "claude-haiku-4-5-20251001" }] }),
		);
		const table = priceTable();
		const list = await listModels("openai", key("oai-key"), {
			priceOf: (m) => priceFor(m, table),
		});
		expect(calls[0]?.url).toBe("https://api.openai.com/v1/models");
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer oai-key");
		expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
		expect(list).toEqual({
			models: [
				{ id: "gpt-x", price: null },
				{
					id: "claude-haiku-4-5-20251001",
					price: table["claude-haiku-4-5"],
				},
			],
		});
	});

	it("pages through Anthropic models by after_id", async () => {
		const calls = stubFetch(
			json({
				data: [{ id: "claude-a", display_name: "Claude A" }],
				has_more: true,
				last_id: "claude-a",
			}),
			json({
				data: [{ id: "claude-b" }],
				has_more: false,
				last_id: "claude-b",
			}),
		);
		const list = await listModels(
			"anthropic",
			key("ant-key", "https://proxy.test/v1/"),
		);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toBe("https://proxy.test/v1/models?limit=1000");
		expect(new URL(calls[1]?.url ?? "").searchParams.get("after_id")).toBe(
			"claude-a",
		);
		expect(calls[0]?.headers.get("x-api-key")).toBe("ant-key");
		expect(calls[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
		expect(list.models).toEqual([
			{ id: "claude-a", name: "Claude A", price: null },
			{ id: "claude-b", price: null },
		]);
	});

	it("caps Anthropic pagination", async () => {
		const calls = stubFetch(
			json({ data: [{ id: "m" }], has_more: true, last_id: "m" }),
		);
		await listModels("anthropic", key("ant-key"));
		expect(calls).toHaveLength(5);
	});

	it("lists only Google models that generate content, keeping the key out of the URL", async () => {
		const calls = stubFetch(
			json({
				models: [
					{
						name: "models/gemini-x",
						displayName: "Gemini X",
						supportedGenerationMethods: ["generateContent", "countTokens"],
					},
					{
						name: "models/embedding-y",
						supportedGenerationMethods: ["embedContent"],
					},
				],
			}),
		);
		const list = await listModels("google", key("AIza-google-key"));
		expect(calls[0]?.url).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
		);
		expect(calls[0]?.url).not.toContain("AIza-google-key");
		expect(calls[0]?.headers.get("x-goog-api-key")).toBe("AIza-google-key");
		expect(list.models).toEqual([
			{ id: "gemini-x", name: "Gemini X", price: null },
		]);
	});

	it("lists an OpenAI-compatible endpoint without a key", async () => {
		const calls = stubFetch(json({ data: [{ id: "llama3" }] }));
		const list = await listModels("openai-compatible", {
			apiKey: undefined,
			baseUrl: "http://ollama:11434/v1",
		});
		expect(calls[0]?.url).toBe("http://ollama:11434/v1/models");
		expect(calls[0]?.headers.get("authorization")).toBeNull();
		expect(list.models).toEqual([{ id: "llama3", price: null }]);
	});

	it("reuses a listing per provider for ten minutes unless refreshed", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const calls = stubFetch(json({ data: [{ id: "gpt-x" }] }));
		await listModels("openai", key("k1"));
		await listModels("openai", key("k1"));
		expect(calls).toHaveLength(1);
		await listModels("openai-compatible", key("k2", "http://x/v1"));
		expect(calls).toHaveLength(2);
		await listModels("openai", key("k1"), { refresh: true });
		expect(calls).toHaveLength(3);
		vi.advanceTimersByTime(MODEL_LIST_TTL_MS + 1);
		await listModels("openai", key("k1"));
		expect(calls).toHaveLength(4);
	});

	it("returns a masked error when the provider echoes the key", async () => {
		const secret = "Tr0ub4dor-and-3-horses-correct";
		stubFetch(
			() =>
				new Response(`{"error": "invalid api key ${secret}"}`, { status: 401 }),
		);
		const list = await listModels("anthropic", key(secret));
		expect(list.models).toEqual([]);
		expect(list.error).toContain("HTTP 401");
		expect(list.error).toContain("[redacted]");
		expect(list.error).not.toContain(secret);
	});

	it("masks a key quoted by a network error and does not cache failures", async () => {
		const secret = "plain-google-secret-value";
		const calls = stubFetch(
			() => {
				throw new TypeError(`fetch failed for https://x.test/?key=${secret}`);
			},
			json({ models: [] }),
		);
		const list = await listModels("google", key(secret));
		expect(list.models).toEqual([]);
		expect(list.error).toMatch(/^Could not load the model list/);
		expect(list.error).not.toContain(secret);
		expect((await listModels("google", key(secret))).error).toBeUndefined();
		expect(calls).toHaveLength(2);
	});

	it("reports an answer that is not a model list", async () => {
		stubFetch(json({ unexpected: true }));
		const list = await listModels("openai", key("k"));
		expect(list).toEqual({
			models: [],
			error:
				"Could not load the model list: the provider's answer was not a model list.",
		});
	});

	it("reports a provider that does not answer in time", async () => {
		stubFetch(() => {
			throw new DOMException("The operation timed out.", "TimeoutError");
		});
		const list = await listModels("openai-compatible", key("", "http://x/v1"));
		expect(list.error).toMatch(/did not answer in time/);
	});
});
