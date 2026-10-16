// Model listing through each provider's REST endpoint. The AI SDK has no listing API.
import type {
	AiCredentials,
	AiProviderName,
	ModelPrice,
} from "#/server/config";
import {
	describeError,
	maskSecrets,
	redactSecrets,
	registerSecret,
} from "./errors";

/** How long a provider's listing is reused. */
export const MODEL_LIST_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
/** Pages fetched at most from a paginated listing. */
const MAX_PAGES = 5;
/** Longest provider response body quoted in an error. */
const MAX_BODY_EXCERPT = 200;

/** The SDKs' default endpoints; a configured base URL replaces them the same way. */
const DEFAULT_BASE: Record<
	Exclude<AiProviderName, "openai-compatible">,
	string
> = {
	openai: "https://api.openai.com/v1",
	anthropic: "https://api.anthropic.com/v1",
	google: "https://generativelanguage.googleapis.com/v1beta",
};

export interface ListedModel {
	id: string;
	/** A display name when the provider gives one. */
	name?: string;
	/** USD per million tokens, or null when the price is unknown. */
	price: ModelPrice | null;
}

/** A listing, or no models and a reader-safe error. Never contains credentials. */
export interface ModelList {
	models: ListedModel[];
	error?: string;
}

export interface ListModelsOptions {
	signal?: AbortSignal;
	/** Fetches again even when a cached listing is fresh. */
	refresh?: boolean;
	/** The known price of a model id, such as from the usage price table. */
	priceOf?: (model: string) => ModelPrice | null;
}

type Entry = { id: string; name?: string };

const cache = new Map<AiProviderName, { at: number; models: Entry[] }>();

/** Forgets every cached listing. For tests. */
export function clearModelListCache(): void {
	cache.clear();
}

/**
 * Lists a provider's models, reusing a listing for MODEL_LIST_TTL_MS. Never
 * throws: a failure returns no models and a masked error, and is not cached.
 */
export async function listModels(
	provider: AiProviderName,
	credentials: AiCredentials,
	options: ListModelsOptions = {},
): Promise<ModelList> {
	registerSecret(credentials.apiKey);
	const priced = (models: Entry[]): ModelList => ({
		models: models.map((m) => ({
			...m,
			price: options.priceOf?.(m.id) ?? null,
		})),
	});
	const hit = cache.get(provider);
	if (!options.refresh && hit && Date.now() - hit.at < MODEL_LIST_TTL_MS) {
		return priced(hit.models);
	}
	const signal = options.signal
		? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)])
		: AbortSignal.timeout(TIMEOUT_MS);
	try {
		const models = await fetchModels(provider, credentials, signal);
		cache.set(provider, { at: Date.now(), models });
		return priced(models);
	} catch (error) {
		return { models: [], error: listingError(error) };
	}
}

class ListingError extends Error {}

function listingError(error: unknown): string {
	if (error instanceof Error && error.name === "TimeoutError") {
		return "Could not load the model list: the provider did not answer in time.";
	}
	if (error instanceof ListingError) {
		return redactSecrets(`Could not load the model list: ${error.message}`);
	}
	// fetch errors can quote the request URL; describeError masks the key.
	return redactSecrets(
		`Could not load the model list: ${describeError(error)}`,
	);
}

async function fetchModels(
	provider: AiProviderName,
	c: AiCredentials,
	signal: AbortSignal,
): Promise<Entry[]> {
	const base = (
		provider === "openai-compatible"
			? (c.baseUrl ?? "")
			: (c.baseUrl ?? DEFAULT_BASE[provider])
	).replace(/\/+$/, "");
	switch (provider) {
		case "openai":
		case "openai-compatible": {
			const headers: Record<string, string> = c.apiKey
				? { authorization: `Bearer ${c.apiKey}` }
				: {};
			const body = await getJson(`${base}/models`, headers, signal);
			return entries(body, "data")
				.filter((m) => typeof m.id === "string")
				.map((m) => ({ id: m.id as string }));
		}
		case "anthropic": {
			const headers = {
				"x-api-key": c.apiKey ?? "",
				"anthropic-version": "2023-06-01",
			};
			const out: Entry[] = [];
			let after: string | undefined;
			for (let page = 0; page < MAX_PAGES; page++) {
				const query = new URLSearchParams({ limit: "1000" });
				if (after) query.set("after_id", after);
				const body = await getJson(`${base}/models?${query}`, headers, signal);
				for (const m of entries(body, "data")) {
					if (typeof m.id !== "string") continue;
					out.push({
						id: m.id,
						name:
							typeof m.display_name === "string" ? m.display_name : undefined,
					});
				}
				const { has_more, last_id } = body as Record<string, unknown>;
				if (has_more !== true || typeof last_id !== "string") break;
				after = last_id;
			}
			return out;
		}
		case "google": {
			// The key goes in a header so it never appears in a URL.
			const headers = { "x-goog-api-key": c.apiKey ?? "" };
			const out: Entry[] = [];
			let token: string | undefined;
			for (let page = 0; page < MAX_PAGES; page++) {
				const query = new URLSearchParams({ pageSize: "1000" });
				if (token) query.set("pageToken", token);
				const body = await getJson(`${base}/models?${query}`, headers, signal);
				for (const m of entries(body, "models")) {
					const methods = m.supportedGenerationMethods;
					if (
						typeof m.name !== "string" ||
						!Array.isArray(methods) ||
						!methods.includes("generateContent")
					)
						continue;
					out.push({
						id: m.name.replace(/^models\//, ""),
						name: typeof m.displayName === "string" ? m.displayName : undefined,
					});
				}
				const next = (body as Record<string, unknown>).nextPageToken;
				if (typeof next !== "string" || next === "") break;
				token = next;
			}
			return out;
		}
	}
}

async function getJson(
	url: string,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<unknown> {
	const response = await fetch(url, { headers, signal });
	if (!response.ok) {
		const text = (await response.text().catch(() => "")).trim();
		// Masked before cutting, so a key cannot survive as a fragment.
		const excerpt = text
			? `: ${maskSecrets(text).slice(0, MAX_BODY_EXCERPT)}`
			: "";
		throw new ListingError(
			`the provider returned HTTP ${response.status}${excerpt}`,
		);
	}
	try {
		return await response.json();
	} catch {
		throw new ListingError("the provider's answer was not a model list.");
	}
}

/** The objects under `key`, or an error when the body has no such list. */
function entries(body: unknown, key: string): Record<string, unknown>[] {
	const list =
		body && typeof body === "object"
			? (body as Record<string, unknown>)[key]
			: undefined;
	if (!Array.isArray(list)) {
		throw new ListingError("the provider's answer was not a model list.");
	}
	return list.filter(
		(m): m is Record<string, unknown> => !!m && typeof m === "object",
	);
}
