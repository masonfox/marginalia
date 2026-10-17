import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { clearModelListCache, listModels, registerSecret } from "#/modules/ai";
import {
	AI_PROVIDERS,
	type AiCredentials,
	type AiProviderName,
} from "#/server/config";
import type { Executor } from "#/server/db";
import { credentialCrypto } from "./crypto";
import { aiCredentials } from "./schema";

export const credentialsInputSchema = z.object({
	provider: z.enum(AI_PROVIDERS),
	apiKey: z
		.string()
		.trim()
		.min(1)
		.max(500)
		.regex(
			// biome-ignore lint/suspicious/noControlCharactersInRegex: API keys must reject control characters.
			/^[^\s\x00-\x1f\x7f]+$/,
			"API key must not contain whitespace or control characters",
		)
		.optional(),
	baseUrl: z
		.string()
		.refine((value) => {
			try {
				const url = new URL(value);
				return (
					["http:", "https:"].includes(url.protocol) &&
					!url.username &&
					!url.password &&
					!url.search &&
					!url.hash &&
					!/[?#]/.test(value)
				);
			} catch {
				return false;
			}
		}, "Base URL must be an absolute http(s) URL without user info, query or fragment")
		.transform((value) => value.replace(/\/+$/, ""))
		.nullable()
		.optional(),
	skipCheck: z.boolean().optional(),
});

export interface ProviderCredentialsStatus {
	provider: AiProviderName;
	configured: boolean;
	apiKeyHint: string | null;
	baseUrl: string | null;
	unreadable: boolean;
}
function readKey(
	row: typeof aiCredentials.$inferSelect,
	secret: string,
): string | null | undefined {
	if (!row.apiKeyCiphertext) return undefined;
	if (!row.apiKeyIv || !row.apiKeyTag || !row.secretKeyId) return null;
	const value = credentialCrypto(secret).decrypt(row.provider, {
		apiKeyCiphertext: row.apiKeyCiphertext,
		apiKeyIv: row.apiKeyIv,
		apiKeyTag: row.apiKeyTag,
		secretKeyId: row.secretKeyId,
	});
	if (value !== null) registerSecret(value);
	return value;
}
function status(
	row: typeof aiCredentials.$inferSelect | undefined,
	provider: AiProviderName,
	secret: string,
): ProviderCredentialsStatus {
	const key = row ? readKey(row, secret) : undefined;
	return {
		provider,
		configured:
			!!row &&
			key !== null &&
			(provider === "openai-compatible" ? !!row.baseUrl : !!key),
		apiKeyHint: row?.apiKeyHint ?? null,
		baseUrl: row?.baseUrl ?? null,
		unreadable: key === null,
	};
}
export async function listProviderCredentials(
	db: Executor,
	secret: string,
): Promise<ProviderCredentialsStatus[]> {
	const rows = await db.select().from(aiCredentials);
	return AI_PROVIDERS.map((provider) =>
		status(
			rows.find((r) => r.provider === provider),
			provider,
			secret,
		),
	);
}
/** Server-only plaintext loader. Never return its result from a server function. */
export async function loadCredentials(
	db: Executor,
	secret: string,
): Promise<Partial<Record<AiProviderName, AiCredentials>>> {
	const rows = await db.select().from(aiCredentials);
	const out: Partial<Record<AiProviderName, AiCredentials>> = {};
	for (const row of rows) {
		const key = readKey(row, secret);
		if (key === null) continue;
		if (row.provider === "openai-compatible" ? !!row.baseUrl : !!key)
			out[row.provider] = { apiKey: key, baseUrl: row.baseUrl ?? undefined };
	}
	return out;
}
export type CredentialsSaveResult =
	| { status: "ok"; credentials: ProviderCredentialsStatus }
	| { status: "invalid"; message: string }
	| { status: "check_failed"; message: string; canSkip: boolean };
export async function saveProviderCredentials(
	db: Executor,
	secret: string,
	input: unknown,
): Promise<CredentialsSaveResult> {
	// Register before validation: even malformed submitted keys must never leak in errors.
	if (
		input &&
		typeof input === "object" &&
		"apiKey" in input &&
		typeof input.apiKey === "string"
	)
		registerSecret(input.apiKey);
	const parsed = credentialsInputSchema.safeParse(input);
	if (!parsed.success)
		return {
			status: "invalid",
			message:
				"Invalid provider credentials. Check the API key and base URL format.",
		};
	const value = parsed.data;
	registerSecret(value.apiKey);
	const [old] = await db
		.select()
		.from(aiCredentials)
		.where(eq(aiCredentials.provider, value.provider));
	const baseUrl =
		value.baseUrl === undefined ? (old?.baseUrl ?? null) : value.baseUrl;
	if (
		old?.apiKeyCiphertext &&
		baseUrl !== old.baseUrl &&
		value.apiKey === undefined
	)
		return {
			status: "invalid",
			message: "Enter the API key again when changing the base URL.",
		};
	const apiKey = value.apiKey ?? (old ? readKey(old, secret) : undefined);
	if (apiKey === null)
		return {
			status: "invalid",
			message: "The saved key is unreadable. Enter it again.",
		};
	if (value.provider === "openai-compatible" ? !baseUrl : !apiKey)
		return {
			status: "invalid",
			message:
				value.provider === "openai-compatible"
					? "A base URL is required."
					: "An API key is required.",
		};
	const check = await listModels(
		value.provider,
		{ apiKey, baseUrl: baseUrl ?? undefined },
		{ refresh: true },
	);
	if (check.error) {
		const canSkip = check.statusCode !== 401 && check.statusCode !== 403;
		if (!canSkip || !value.skipCheck)
			return { status: "check_failed", message: check.error, canSkip };
	}
	const encrypted = apiKey
		? credentialCrypto(secret).encrypt(value.provider, apiKey)
		: {
				apiKeyCiphertext: null,
				apiKeyIv: null,
				apiKeyTag: null,
				secretKeyId: null,
			};
	const record = {
		provider: value.provider,
		...encrypted,
		apiKeyHint: apiKey?.slice(-4) ?? null,
		baseUrl,
	};
	const [saved] = await db
		.insert(aiCredentials)
		.values(record)
		.onConflictDoUpdate({
			target: aiCredentials.provider,
			set: { ...record, updatedAt: sql`now()` },
		})
		.returning();
	clearModelListCache(value.provider);
	return { status: "ok", credentials: status(saved, value.provider, secret) };
}
export async function removeProviderCredentials(
	db: Executor,
	provider: AiProviderName,
): Promise<void> {
	await db.delete(aiCredentials).where(eq(aiCredentials.provider, provider));
	clearModelListCache(provider);
}
