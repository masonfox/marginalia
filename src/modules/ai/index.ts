// Language model selection from configuration. No database access.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, streamText } from "ai";
import type {
	AiConfig,
	AiCredentials,
	AiProviderName,
	AiSelection,
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

/** Maps configuration to an AI SDK model. Returns a disabled runtime when no env default model is set. */
export function createAi(config: AiConfig | undefined): AiRuntime {
	// Providers may echo a key in errors, whatever its shape.
	for (const c of Object.values(config?.credentials ?? {})) {
		registerSecret(c.apiKey);
	}
	const chat = config?.envDefaults.chat;
	const credentials = chat && config?.credentials[chat.provider];
	if (!config || !chat || !credentials) {
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
	// The env preprocess default shares the chat provider, so its credentials exist.
	const preprocess = config.envDefaults.preprocess ?? chat;
	return {
		model: buildModel(chat, credentials),
		preprocessModel: buildModel(preprocess, credentials),
		status: {
			enabled: true,
			provider: chat.provider,
			model: chat.model,
			preprocessModel: preprocess.model,
		},
		maxSteps: config.maxSteps,
		temperature: config.temperature,
		reasoning: config.effort,
		providerOptions: buildProviderOptions(chat.provider, config.promptCache),
	};
}

/**
 * Anthropic caches only when asked. A request-level cache instruction caches
 * up to the last cacheable block, so each tool-loop step and the next turn
 * read the earlier prefix. OpenAI and Google cache on their own.
 */
function buildProviderOptions(
	provider: AiProviderName,
	promptCache: boolean,
): ProviderOptions {
	if (provider === "anthropic" && promptCache) {
		return { anthropic: { cacheControl: { type: "ephemeral" } } };
	}
	return {};
}

function buildModel(
	{ provider, model: modelId }: AiSelection,
	c: AiCredentials,
): LanguageModel {
	switch (provider) {
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
