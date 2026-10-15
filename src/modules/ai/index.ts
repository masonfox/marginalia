// Language model selection from configuration. No database access.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, streamText } from "ai";
import type {
	AiConfig,
	AiProviderName,
	ReasoningEffort,
} from "#/server/config";

import { registerSecret } from "./errors";

export {
	clearSecrets,
	describeError,
	MAX_ERROR_LENGTH,
	maskSecrets,
	redactSecrets,
	registerSecret,
} from "./errors";

/** What the UI may know about the AI setup. Never contains the API key. */
export interface AiStatus {
	enabled: boolean;
	provider?: AiProviderName;
	model?: string;
	preprocessModel?: string;
}

export type ProviderOptions = NonNullable<
	Parameters<typeof streamText>[0]["providerOptions"]
>;

export interface AiRuntime {
	/** The configured model, or null when AI is disabled. */
	model: LanguageModel | null;
	/** The model for whole-book preprocessing, or null when AI is disabled. */
	preprocessModel: LanguageModel | null;
	status: AiStatus;
	maxSteps: number;
	temperature: number | undefined;
	/** Reasoning effort for every call; undefined leaves the provider default. */
	reasoning: ReasoningEffort | undefined;
	/** Provider-specific call options, such as Anthropic prompt caching. */
	providerOptions: ProviderOptions;
}

/** Maps configuration to an AI SDK model. Returns a disabled runtime when no provider is set. */
export function createAi(config: AiConfig | undefined): AiRuntime {
	if (!config) {
		return {
			model: null,
			preprocessModel: null,
			status: { enabled: false },
			maxSteps: 8,
			temperature: undefined,
			reasoning: undefined,
			providerOptions: {},
		};
	}
	// Providers may echo the key in errors, whatever its shape.
	registerSecret(config.apiKey);
	return {
		model: buildModel(config),
		preprocessModel: buildModel(config, config.preprocessModel),
		status: {
			enabled: true,
			provider: config.provider,
			model: config.model,
			preprocessModel: config.preprocessModel,
		},
		maxSteps: config.maxSteps,
		temperature: config.temperature,
		reasoning: config.effort,
		providerOptions: buildProviderOptions(config),
	};
}

/**
 * Anthropic caches only when asked. A request-level cache instruction caches
 * up to the last cacheable block, so each tool-loop step and the next turn
 * read the earlier prefix. OpenAI and Google cache on their own.
 */
function buildProviderOptions(c: AiConfig): ProviderOptions {
	if (c.provider === "anthropic" && c.promptCache) {
		return { anthropic: { cacheControl: { type: "ephemeral" } } };
	}
	return {};
}

function buildModel(c: AiConfig, modelId: string = c.model): LanguageModel {
	switch (c.provider) {
		case "openai":
			return createOpenAI({ apiKey: c.apiKey, baseURL: c.baseUrl })(modelId);
		case "anthropic":
			return createAnthropic({ apiKey: c.apiKey, baseURL: c.baseUrl })(modelId);
		case "google":
			return createGoogle({ apiKey: c.apiKey, baseURL: c.baseUrl })(modelId);
		case "openai-compatible":
			return createOpenAICompatible({
				name: "openai-compatible",
				baseURL: c.baseUrl ?? "",
				apiKey: c.apiKey,
			})(modelId);
	}
}

/** The model used for whole-book preprocessing, or null when AI is disabled. */
export function getPreprocessModel(ai: AiRuntime): LanguageModel | null {
	return ai.preprocessModel;
}
