// Language model selection from configuration. No database access.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AiConfig, AiProviderName } from "#/server/config";

/** What the UI may know about the AI setup. Never contains the API key. */
export interface AiStatus {
	enabled: boolean;
	provider?: AiProviderName;
	model?: string;
}

export interface AiRuntime {
	/** The configured model, or null when AI is disabled. */
	model: LanguageModel | null;
	status: AiStatus;
	maxSteps: number;
	temperature: number | undefined;
}

/** Maps configuration to an AI SDK model. Returns a disabled runtime when no provider is set. */
export function createAi(config: AiConfig | undefined): AiRuntime {
	if (!config) {
		return {
			model: null,
			status: { enabled: false },
			maxSteps: 8,
			temperature: undefined,
		};
	}
	return {
		model: buildModel(config),
		status: { enabled: true, provider: config.provider, model: config.model },
		maxSteps: config.maxSteps,
		temperature: config.temperature,
	};
}

function buildModel(c: AiConfig): LanguageModel {
	switch (c.provider) {
		case "openai":
			return createOpenAI({ apiKey: c.apiKey, baseURL: c.baseUrl })(c.model);
		case "anthropic":
			return createAnthropic({ apiKey: c.apiKey, baseURL: c.baseUrl })(c.model);
		case "google":
			return createGoogle({ apiKey: c.apiKey, baseURL: c.baseUrl })(c.model);
		case "openai-compatible":
			return createOpenAICompatible({
				name: "openai-compatible",
				baseURL: c.baseUrl ?? "",
				apiKey: c.apiKey,
			})(c.model);
	}
}
