import { describe, expect, it } from "vitest";
import type { AiConfig } from "#/server/config";
import { createAi } from "./index";

const cfg = (over: Partial<AiConfig>): AiConfig => ({
	provider: "openai",
	model: "m1",
	apiKey: "sk-secret",
	baseUrl: undefined,
	maxSteps: 8,
	temperature: undefined,
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
			model: "claude-x",
		});
		expect(JSON.stringify(ai.status)).not.toContain("sk-secret");
	});

	it("carries step and temperature settings", () => {
		const ai = createAi(cfg({ maxSteps: 3, temperature: 0.2 }));
		expect(ai.maxSteps).toBe(3);
		expect(ai.temperature).toBe(0.2);
	});
});
