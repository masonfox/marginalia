// Language model resolution from configuration. No database access.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, streamText } from "ai";
import {
	AI_PROVIDERS,
	type AiConfig,
	type AiCredentials,
	type AiProviderName,
	type AiSelection,
	type ReasoningEffort,
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
export {
	clearModelListCache,
	type ListedModel,
	type ListModelsOptions,
	listModels,
	MODEL_LIST_TTL_MS,
	type ModelList,
} from "./models";
export { MAX_MODEL_ID_LENGTH, selectionSchema } from "./selection";

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

/** A selection ready to call, or why it cannot be. */
export type ResolvedModel =
	| {
			ok: true;
			model: LanguageModel;
			/** Call options for this provider, such as Anthropic prompt caching. */
			providerOptions: ProviderOptions;
			selection: AiSelection;
	  }
	| { ok: false; reason: "unavailable" };

export interface AiRuntime {
	/** Providers with credentials, in a fixed order. */
	available(): AiProviderName[];
	/** Builds a model for a selection with its provider's credentials. */
	resolve(selection: AiSelection): ResolvedModel;
	/** Defaults from AI_PROVIDER with AI_MODEL and AI_PREPROCESS_MODEL. */
	envDefaults: AiConfig["envDefaults"];
	status: AiStatus;
	maxSteps: number;
	temperature: number | undefined;
	/** Reasoning effort for every call; undefined leaves the provider default. */
	reasoning: ReasoningEffort | undefined;
}

type ProviderFactory = (modelId: string) => LanguageModel;

/** Resolves models from configuration. AI is disabled when no provider has credentials. */
export function createAi(config: AiConfig | undefined): AiRuntime {
	const credentials = config?.credentials ?? {};
	// Providers may echo a key in errors, whatever its shape.
	for (const c of Object.values(credentials)) registerSecret(c.apiKey);
	const available = AI_PROVIDERS.filter((p) => credentials[p] !== undefined);
	const promptCache = config?.promptCache ?? true;
	// Provider factories hold the credentials; models are cheap, so built per call.
	const factories = new Map<AiProviderName, ProviderFactory>();

	const resolve = (selection: AiSelection): ResolvedModel => {
		const c = credentials[selection.provider];
		if (!c) return { ok: false, reason: "unavailable" };
		let factory = factories.get(selection.provider);
		if (!factory) {
			factory = buildFactory(selection.provider, c);
			factories.set(selection.provider, factory);
		}
		return {
			ok: true,
			model: factory(selection.model),
			providerOptions: buildProviderOptions(selection.provider, promptCache),
			selection: { provider: selection.provider, model: selection.model },
		};
	};

	const envDefaults = config?.envDefaults ?? {};
	const chat = envDefaults.chat;
	// The env preprocess default shares the chat provider.
	const preprocess = envDefaults.preprocess ?? chat;
	const status: AiStatus =
		chat && credentials[chat.provider]
			? {
					enabled: true,
					provider: chat.provider,
					model: chat.model,
					preprocessModel: preprocess?.model,
				}
			: { enabled: false };

	return {
		available: () => [...available],
		resolve,
		envDefaults,
		status,
		maxSteps: config?.maxSteps ?? 8,
		temperature: config?.temperature,
		reasoning: config?.effort,
	};
}

/**
 * Anthropic caches only when asked. A request-level cache instruction caches
 * up to the last cacheable block, so each tool-loop step and the next turn
 * read the earlier prefix. OpenAI and Google cache on their own.
 */
export function buildProviderOptions(
	provider: AiProviderName,
	promptCache: boolean,
): ProviderOptions {
	if (provider === "anthropic" && promptCache) {
		return { anthropic: { cacheControl: { type: "ephemeral" } } };
	}
	return {};
}

function buildFactory(
	provider: AiProviderName,
	c: AiCredentials,
): ProviderFactory {
	switch (provider) {
		case "openai":
			return createOpenAI({ apiKey: c.apiKey, baseURL: c.baseUrl });
		case "anthropic":
			return createAnthropic({ apiKey: c.apiKey, baseURL: c.baseUrl });
		case "google":
			return createGoogle({ apiKey: c.apiKey, baseURL: c.baseUrl });
		case "openai-compatible":
			return createOpenAICompatible({
				name: "openai-compatible",
				baseURL: c.baseUrl ?? "",
				apiKey: c.apiKey,
			});
	}
}
