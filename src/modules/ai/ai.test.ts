import { APICallError, generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiConfig, AiProviderName, AiSelection } from "#/server/config";
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

interface Single {
	provider: AiProviderName;
	model: string;
	preprocessModel: string;
	apiKey: string | undefined;
	baseUrl: string | undefined;
	maxSteps: number;
	temperature: number | undefined;
	effort: AiConfig["effort"];
	promptCache: boolean;
}

/** A config with one provider, as AI_PROVIDER would give. */
const cfg = (over: Partial<Single>): AiConfig => {
	const c: Single = {
		provider: "openai",
		model: "m1",
		preprocessModel: "m1",
		apiKey: "sk-secret",
		baseUrl: undefined,
		maxSteps: 8,
		temperature: undefined,
		effort: undefined,
		promptCache: true,
		...over,
	};
	return {
		credentials: { [c.provider]: { apiKey: c.apiKey, baseUrl: c.baseUrl } },
		envDefaults: {
			chat: { provider: c.provider, model: c.model },
			preprocess: { provider: c.provider, model: c.preprocessModel },
		},
		maxSteps: c.maxSteps,
		temperature: c.temperature,
		effort: c.effort,
		promptCache: c.promptCache,
		prices: {},
	};
};

/** A config with several providers, as the per-provider variables would give. */
const multi = (
	credentials: AiConfig["credentials"],
	over: Partial<AiConfig> = {},
): AiConfig => ({
	credentials,
	envDefaults: {},
	maxSteps: 8,
	temperature: undefined,
	effort: undefined,
	promptCache: true,
	prices: {},
	...over,
});

function resolved(ai: AiRuntime, selection: AiSelection) {
	const r = ai.resolve(selection);
	if (!r.ok) throw new Error("unavailable");
	if (typeof r.model === "string") throw new Error("no model object");
	return { ...r, model: r.model };
}

function modelOf(over: Partial<Single>) {
	const c = cfg(over);
	const chat = c.envDefaults.chat as AiSelection;
	return resolved(createAi(c), chat).model;
}

/** The headers a resolved model sends, read from the request it makes. */
async function headersOf(ai: AiRuntime, selection: AiSelection) {
	let seen: Headers | undefined;
	const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
		seen = new Headers(init?.headers);
		return new Response("{}", { status: 401 });
	});
	vi.stubGlobal("fetch", fetchMock);
	try {
		const { model } = resolved(ai, selection);
		await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(
			() => undefined,
		);
	} finally {
		vi.unstubAllGlobals();
	}
	if (!seen) throw new Error("no request made");
	return seen;
}

describe("createAi", () => {
	it("is disabled without configuration", () => {
		const ai = createAi(undefined);
		expect(ai.available()).toEqual([]);
		expect(ai.resolve({ provider: "openai", model: "m" })).toEqual({
			ok: false,
			reason: "unavailable",
		});
		expect(ai.status).toEqual({ enabled: false });
	});

	it.each([
		["openai", "openai"],
		["anthropic", "anthropic"],
		["google", "google"],
	] as const)("maps %s to a %s model", (provider, prefix) => {
		const m = modelOf({ provider, model: "model-x" });
		expect(m.provider).toContain(prefix);
		expect(m.modelId).toBe("model-x");
	});

	it("maps openai-compatible with a base URL and no key", () => {
		const m = modelOf({
			provider: "openai-compatible",
			model: "llama3",
			apiKey: undefined,
			baseUrl: "http://localhost:11434/v1",
		});
		expect(m.modelId).toBe("llama3");
	});

	it("lists the providers with credentials", () => {
		const ai = createAi(
			multi({
				"openai-compatible": { apiKey: undefined, baseUrl: "http://x/v1" },
				anthropic: { apiKey: "sk-ant-a", baseUrl: undefined },
			}),
		);
		expect(ai.available()).toEqual(["anthropic", "openai-compatible"]);
	});

	it("resolves two providers, each with its own key", async () => {
		const ai = createAi(
			multi({
				anthropic: { apiKey: "ant-key-1", baseUrl: undefined },
				openai: { apiKey: "oai-key-2", baseUrl: undefined },
			}),
		);
		const claude = { provider: "anthropic", model: "claude-x" } as const;
		const gpt = { provider: "openai", model: "gpt-x" } as const;
		expect(resolved(ai, claude).selection).toEqual(claude);
		expect(resolved(ai, gpt).model.modelId).toBe("gpt-x");
		expect((await headersOf(ai, claude)).get("x-api-key")).toBe("ant-key-1");
		expect((await headersOf(ai, gpt)).get("authorization")).toBe(
			"Bearer oai-key-2",
		);
	});

	it("returns unavailable for a provider without credentials", () => {
		const ai = createAi(
			multi({ anthropic: { apiKey: "sk-ant-a", baseUrl: undefined } }),
		);
		expect(ai.resolve({ provider: "google", model: "gemini-x" })).toEqual({
			ok: false,
			reason: "unavailable",
		});
	});

	it("keeps the env defaults and reports a status without the key", () => {
		const c = cfg({ provider: "anthropic", model: "claude-x" });
		const ai = createAi(c);
		expect(ai.envDefaults).toEqual(c.envDefaults);
		expect(ai.status).toEqual({
			enabled: true,
			provider: "anthropic",
			preprocessModel: "m1",
			model: "claude-x",
		});
		expect(JSON.stringify(ai.status)).not.toContain("sk-secret");
	});

	it("carries step and temperature settings", () => {
		const ai = createAi(cfg({ maxSteps: 3, temperature: 0.2 }));
		expect(ai.maxSteps).toBe(3);
		expect(ai.temperature).toBe(0.2);
	});

	it("requests prompt caching only for Anthropic selections", () => {
		const ai = createAi(
			multi({
				anthropic: { apiKey: "sk-ant-a", baseUrl: undefined },
				openai: { apiKey: "sk-oai-b", baseUrl: undefined },
				google: { apiKey: "AIza-c", baseUrl: undefined },
				"openai-compatible": { apiKey: undefined, baseUrl: "http://x/v1" },
			}),
		);
		expect(
			resolved(ai, { provider: "anthropic", model: "c" }).providerOptions,
		).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
		for (const provider of ["openai", "google", "openai-compatible"] as const) {
			expect(resolved(ai, { provider, model: "m" }).providerOptions).toEqual(
				{},
			);
		}
	});

	it("sends no cache instruction when caching is off", () => {
		const ai = createAi(cfg({ provider: "anthropic", promptCache: false }));
		expect(
			resolved(ai, { provider: "anthropic", model: "c" }).providerOptions,
		).toEqual({});
		expect(buildProviderOptions("anthropic", false)).toEqual({});
	});

	it("passes effort through and leaves it unset by default", () => {
		expect(createAi(cfg({ effort: "low" })).reasoning).toBe("low");
		expect(createAi(cfg({})).reasoning).toBeUndefined();
		expect(createAi(undefined).reasoning).toBeUndefined();
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
		createAi(cfg({ provider: "openai-compatible", apiKey: groqKey }));
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
		createAi(cfg({ provider: "openai-compatible", apiKey: shortKey }));
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
		createAi(cfg({ provider: "openai-compatible", apiKey: "" }));
		expect(redactSecrets("the book")).toBe("the book");
	});
});
