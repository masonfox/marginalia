import { APICallError } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AiConfig } from "#/server/config";
import {
	clearSecrets,
	createAi,
	describeError,
	MAX_ERROR_LENGTH,
	redactSecrets,
	registerSecret,
} from "./index";

const cfg = (over: Partial<AiConfig>): AiConfig => ({
	provider: "openai",
	model: "m1",
	preprocessModel: "m1",
	apiKey: "sk-secret",
	baseUrl: undefined,
	maxSteps: 8,
	temperature: undefined,
	effort: undefined,
	promptCache: true,
	prices: {},
	...over,
});

function modelOf(over: Partial<AiConfig>) {
	const { model } = createAi(cfg(over));
	if (!model || typeof model === "string") throw new Error("no model object");
	return model;
}

describe("createAi", () => {
	it("is disabled without configuration", () => {
		const ai = createAi(undefined);
		expect(ai.model).toBeNull();
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

	it("reports a status without the key", () => {
		const ai = createAi(cfg({ provider: "anthropic", model: "claude-x" }));
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

	it("requests prompt caching from Anthropic by default", () => {
		const ai = createAi(cfg({ provider: "anthropic" }));
		expect(ai.providerOptions).toEqual({
			anthropic: { cacheControl: { type: "ephemeral" } },
		});
	});

	it("sends no cache instruction when caching is off", () => {
		const ai = createAi(cfg({ provider: "anthropic", promptCache: false }));
		expect(ai.providerOptions).toEqual({});
	});

	it.each([
		"openai",
		"google",
		"openai-compatible",
	] as const)("needs no provider options for %s", (provider) => {
		const ai = createAi(
			cfg({ provider, baseUrl: "http://localhost:11434/v1" }),
		);
		expect(ai.providerOptions).toEqual({});
	});

	it("passes effort through and leaves it unset by default", () => {
		expect(createAi(cfg({ effort: "low" })).reasoning).toBe("low");
		expect(createAi(cfg({})).reasoning).toBeUndefined();
		expect(createAi(undefined).reasoning).toBeUndefined();
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

	it("ignores short values that would mangle ordinary text", () => {
		registerSecret("the");
		registerSecret(undefined);
		expect(redactSecrets("the book")).toBe("the book");
	});
});
