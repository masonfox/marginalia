import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	AiConfig,
	AiCredentials,
	AiProviderName,
	AiSelection,
} from "#/server/config";
import {
	type AiRuntime,
	buildProviderOptions,
	clearSecrets,
	createAi,
	describeError,
	MAX_ERROR_LENGTH,
	MAX_MODEL_ID_LENGTH,
	maskSecrets,
	redactSecrets,
	registerSecret,
	selectionSchema,
} from "./index";

vi.mock("@ai-sdk/openai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@ai-sdk/openai")>();
	return { ...actual, createOpenAI: vi.fn(actual.createOpenAI) };
});
const config: AiConfig = {
	maxSteps: 8,
	temperature: undefined,
	effort: undefined,
	promptCache: true,
	prices: {},
};
type Credentials = Partial<Record<AiProviderName, AiCredentials>>;
async function resolved(ai: AiRuntime, selection: AiSelection) {
	const r = await ai.resolve(selection);
	if (!r.ok || typeof r.model === "string") throw new Error("unavailable");
	return { ...r, model: r.model };
}
async function headersOf(ai: AiRuntime, selection: AiSelection) {
	let seen: Headers | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, init?: RequestInit) => {
			seen = new Headers(init?.headers);
			return new Response("{}", { status: 401 });
		}),
	);
	try {
		const { model } = await resolved(ai, selection);
		await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(
			() => undefined,
		);
	} finally {
		vi.unstubAllGlobals();
	}
	if (!seen) throw new Error("no request");
	return seen;
}
describe("createAi", () => {
	it("is disabled without stored credentials", async () => {
		const ai = createAi(config);
		expect(await ai.available()).toEqual([]);
		expect(await ai.resolve({ provider: "openai", model: "m" })).toEqual({
			ok: false,
			reason: "unavailable",
		});
	});
	it.each([
		"openai",
		"anthropic",
		"google",
		"openai-compatible",
	] as const)("builds %s models", async (provider) => {
		const ai = createAi(config, async () => ({
			[provider]: {
				apiKey: "private-key",
				baseUrl: "http://localhost:11434/v1",
			},
		}));
		const r = await resolved(ai, { provider, model: "model-x" });
		expect(r.model.modelId).toBe("model-x");
	});
	it("resolves each provider with its own credentials and caching options", async () => {
		const ai = createAi(config, async () => ({
			openai: { apiKey: "openai-private", baseUrl: undefined },
			anthropic: { apiKey: "anthropic-private", baseUrl: undefined },
		}));
		expect(await ai.available()).toEqual(["openai", "anthropic"]);
		expect(
			(await headersOf(ai, { provider: "openai", model: "m" })).get(
				"authorization",
			),
		).toBe("Bearer openai-private");
		expect(
			(await headersOf(ai, { provider: "anthropic", model: "m" })).get(
				"x-api-key",
			),
		).toBe("anthropic-private");
		expect(
			(await resolved(ai, { provider: "anthropic", model: "m" }))
				.providerOptions,
		).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
		expect(
			(await resolved(ai, { provider: "openai", model: "m" })).providerOptions,
		).toEqual({});
		expect(buildProviderOptions("anthropic", false)).toEqual({});
	});
	it("reads changed and removed credentials on every call and masks keys added after boot", async () => {
		let credentials: Credentials = {};
		const load = vi.fn(async () => credentials);
		const ai = createAi(config, load);
		expect(await ai.available()).toEqual([]);
		credentials = {
			openai: { apiKey: "first-private-key", baseUrl: undefined },
		};
		const count = vi.mocked(createOpenAI).mock.calls.length;
		const first = await resolved(ai, { provider: "openai", model: "m" });
		const again = await resolved(ai, { provider: "openai", model: "m" });
		expect(again.model.modelId).toBe(first.model.modelId);
		expect(vi.mocked(createOpenAI).mock.calls.length).toBe(count + 1);
		credentials = {
			openai: { apiKey: "replacement-private-key", baseUrl: undefined },
		};
		const replacement = await resolved(ai, { provider: "openai", model: "m" });
		expect(replacement.model).not.toBe(first.model);
		expect(vi.mocked(createOpenAI).mock.calls.length).toBe(count + 2);
		expect(
			(await headersOf(ai, { provider: "openai", model: "m" })).get(
				"authorization",
			),
		).toBe("Bearer replacement-private-key");
		expect(describeError(new Error("bad replacement-private-key"))).toBe(
			"bad [redacted]",
		);
		credentials = {};
		expect(await ai.resolve({ provider: "openai", model: "m" })).toEqual({
			ok: false,
			reason: "unavailable",
		});
		expect(await ai.available()).toEqual([]);
	});
	it("retains tuning", () => {
		const ai = createAi({
			...config,
			maxSteps: 3,
			temperature: 0.2,
			effort: "low",
		});
		expect(ai).toMatchObject({
			maxSteps: 3,
			temperature: 0.2,
			reasoning: "low",
		});
	});
});
describe("selectionSchema", () => {
	it("trims and accepts an unlisted model id", () => {
		expect(
			selectionSchema.parse({ provider: "openai", model: "  my-model  " }),
		).toEqual({ provider: "openai", model: "my-model" });
	});

	it.each([
		["blank", ""],
		["whitespace only", "   "],
		["too long", "m".repeat(MAX_MODEL_ID_LENGTH + 1)],
		["a control character", "gpt\u0007x"],
		["a newline", "gpt\nx"],
		["a delete character", "gpt\u007fx"],
	])("rejects a model id that is %s", (_, model) => {
		expect(
			selectionSchema.safeParse({ provider: "openai", model }).success,
		).toBe(false);
	});

	it("accepts the longest allowed id and rejects an unknown provider", () => {
		const longest = "m".repeat(MAX_MODEL_ID_LENGTH);
		expect(
			selectionSchema.safeParse({ provider: "openai", model: longest }).success,
		).toBe(true);
		expect(
			selectionSchema.safeParse({ provider: "mistral", model: "m" }).success,
		).toBe(false);
	});
});

describe("secret masking", () => {
	const groqKey = `gsk_${"Ab3".repeat(14)}`;
	const plainKey = "Tr0ub4dor-and-3-horses-correct";

	afterEach(() => clearSecrets());

	it("masks a configured key of any shape everywhere it appears", () => {
		registerSecret(groqKey);
		registerSecret(plainKey);
		const text = `token ${groqKey} rejected; also ${plainKey}, ${plainKey}`;
		const masked = redactSecrets(text);
		expect(masked).not.toContain(groqKey);
		expect(masked).not.toContain(plainKey);
		expect(masked.split("[redacted]")).toHaveLength(4);
		expect(describeError(new Error(text))).toBe(masked);
	});

	it("masks a key inside a provider error and before truncation", () => {
		registerSecret(plainKey);
		const err = new APICallError({
			message: `Invalid API token: ${plainKey}`,
			url: "https://example.test/v1/chat",
			requestBodyValues: {},
			statusCode: 401,
		});
		const shown = describeError(err);
		expect(shown).toContain("(HTTP 401)");
		expect(shown).toContain("[redacted]");
		expect(shown).not.toContain(plainKey);
		// Masking first keeps the key from surviving as a cut-off fragment.
		const long = describeError(
			new Error(`${"x".repeat(MAX_ERROR_LENGTH - 10)}${plainKey}`),
		);
		expect(long.length).toBeLessThanOrEqual(MAX_ERROR_LENGTH);
		expect(long).not.toContain(plainKey.slice(0, 10));
	});

	it("masks a short configured key", () => {
		const shortKey = "token42";
		registerSecret(shortKey);
		const err = new APICallError({
			message: `Invalid API token: ${shortKey}`,
			url: "https://example.test/v1/chat",
			requestBodyValues: {},
			statusCode: 401,
		});
		expect(describeError(err)).not.toContain(shortKey);
		expect(describeError(err)).toContain("[redacted]");
		expect(redactSecrets(`bad ${shortKey}`)).toBe("bad [redacted]");
		expect(maskSecrets(`bad ${shortKey}`)).toBe("bad [redacted]");
	});

	it("masks a longer secret whole when a shorter one is inside it", () => {
		registerSecret("token4242");
		registerSecret("token4242-extended");
		expect(maskSecrets("bad token4242-extended")).toBe("bad [redacted]");
	});

	it("ignores undefined and empty values", () => {
		registerSecret(undefined);
		registerSecret("");
		expect(redactSecrets("the book")).toBe("the book");
	});
});
