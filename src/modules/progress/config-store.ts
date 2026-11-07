// Stored provider configuration (design D4): plain fields as jsonb, every
// secret field in one AES-GCM blob. Browsers only ever see hints of secrets.
import { eq, sql } from "drizzle-orm";
import { registerSecret } from "#/modules/ai";
import { credentialCrypto } from "#/modules/settings";
import type { Executor } from "#/server/db";
import { getProvider, listProviders } from "./registry";
import { progressProviders } from "./schema";
import {
	type ConfigField,
	type ProviderConfig,
	type ProviderKind,
	SYNC_SCHEDULES,
	type SyncSchedule,
} from "./types";

type Row = typeof progressProviders.$inferSelect;

/** A secret field as the browser sees it: whether it is set, and a hint. */
export interface SecretFieldStatus {
	set: boolean;
	/** The last four characters, only for secrets long enough to spare them. */
	hint: string | null;
}

/** A provider's stored configuration, safe to return to the browser. */
export interface ProviderConfigView {
	kind: ProviderKind;
	label: string;
	/** Whether a row exists for this provider. */
	saved: boolean;
	enabled: boolean;
	/** Lower wins; null until saved. */
	priority: number | null;
	schedule: SyncSchedule;
	/** Plain (non-secret) field values. */
	values: Record<string, string>;
	secrets: Record<string, SecretFieldStatus>;
	/** Every required field has a value. */
	configured: boolean;
	/** The saved secrets could not be decrypted (e.g. the secret key changed). */
	unreadable: boolean;
	lastSyncAt: Date | null;
	lastSyncMatched: number | null;
	lastError: string | null;
}

export interface ProviderConfigInput {
	enabled?: boolean;
	schedule?: SyncSchedule;
	/**
	 * Field values keyed by `ConfigField.key`. An omitted plain field keeps its
	 * value and a blank one clears it; an omitted or blank secret keeps the
	 * saved secret.
	 */
	values?: Record<string, string | undefined>;
}

export type ProviderConfigSaveResult =
	| { status: "ok"; provider: ProviderConfigView }
	| { status: "invalid"; message: string };

/** What the server loader found for a provider. */
export type LoadedProviderConfig =
	| { status: "ok"; config: ProviderConfig }
	| { status: "missing" }
	| { status: "unreadable" };

const HINT_MIN_LENGTH = 8;
const MAX_VALUE_LENGTH = 2000;

const aad = (kind: ProviderKind) => `progress:${kind}`;

/** Decrypted secrets: undefined when none are stored, null when unreadable. */
function readSecrets(
	row: Row,
	secret: string,
): Record<string, string> | null | undefined {
	if (!row.secretsCiphertext) return undefined;
	if (!row.secretsIv || !row.secretsTag || !row.secretKeyId) return null;
	const plain = credentialCrypto(secret).decrypt(aad(row.kind), {
		apiKeyCiphertext: row.secretsCiphertext,
		apiKeyIv: row.secretsIv,
		apiKeyTag: row.secretsTag,
		secretKeyId: row.secretKeyId,
	});
	if (plain === null) return null;
	try {
		const parsed: unknown = JSON.parse(plain);
		if (!parsed || typeof parsed !== "object") return null;
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed))
			if (typeof value === "string") {
				registerSecret(value);
				out[key] = value;
			}
		return out;
	} catch {
		return null;
	}
}

function view(
	kind: ProviderKind,
	row: Row | undefined,
	secret: string,
): ProviderConfigView {
	const provider = getProvider(kind);
	const stored = row ? readSecrets(row, secret) : undefined;
	const values: Record<string, string> = {};
	const secrets: Record<string, SecretFieldStatus> = {};
	let configured = true;
	for (const field of provider.configFields) {
		if (field.type === "secret") {
			const value = stored?.[field.key];
			secrets[field.key] = {
				set: !!value,
				hint: value && value.length >= HINT_MIN_LENGTH ? value.slice(-4) : null,
			};
			if (field.required && !value) configured = false;
		} else {
			const value = row?.config[field.key];
			if (value) values[field.key] = value;
			if (field.required && !value) configured = false;
		}
	}
	return {
		kind,
		label: provider.label,
		saved: !!row,
		enabled: row?.enabled ?? false,
		priority: row?.priority ?? null,
		schedule: row?.schedule ?? "manual",
		values,
		secrets,
		configured,
		unreadable: stored === null,
		lastSyncAt: row?.lastSyncAt ?? null,
		lastSyncMatched: row?.lastSyncMatched ?? null,
		lastError: row?.lastError ?? null,
	};
}

/** Every built-in provider's configuration, saved or not, hints only. */
export async function listProviderConfigs(
	db: Executor,
	secret: string,
): Promise<ProviderConfigView[]> {
	const rows = await db.select().from(progressProviders);
	return listProviders().map((p) =>
		view(
			p.kind,
			rows.find((r) => r.kind === p.kind),
			secret,
		),
	);
}

/** One provider's configuration, hints only. */
export async function getProviderConfig(
	db: Executor,
	secret: string,
	kind: ProviderKind,
): Promise<ProviderConfigView> {
	const [row] = await db
		.select()
		.from(progressProviders)
		.where(eq(progressProviders.kind, kind));
	return view(kind, row, secret);
}

/**
 * Server-only plaintext loader for adapters: plain and secret fields merged.
 * Never return its result from a server function.
 */
export async function loadProviderConfig(
	db: Executor,
	secret: string,
	kind: ProviderKind,
): Promise<LoadedProviderConfig> {
	const [row] = await db
		.select()
		.from(progressProviders)
		.where(eq(progressProviders.kind, kind));
	if (!row) return { status: "missing" };
	const secrets = readSecrets(row, secret);
	if (secrets === null) return { status: "unreadable" };
	return { status: "ok", config: { ...row.config, ...secrets } };
}

function checkValue(field: ConfigField, value: string): string | null {
	if (value.length > MAX_VALUE_LENGTH) return `${field.label} is too long.`;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: config values must reject control characters.
	if (/[\x00-\x1f\x7f]/.test(value))
		return `${field.label} must not contain control characters.`;
	if (field.type === "url") {
		try {
			const url = new URL(value);
			if (!["http:", "https:"].includes(url.protocol)) throw new Error();
		} catch {
			return `${field.label} must be an absolute http(s) URL.`;
		}
	}
	return null;
}

/**
 * Saves a provider's configuration, creating the row with the next free
 * priority if needed. Secrets left blank keep their saved value.
 */
export async function saveProviderConfig(
	db: Executor,
	secret: string,
	kind: ProviderKind,
	input: ProviderConfigInput,
): Promise<ProviderConfigSaveResult> {
	const provider = getProvider(kind);
	const fields = new Map(provider.configFields.map((f) => [f.key, f]));
	const values = input.values ?? {};
	// Register before validating: submitted secrets must never leak in errors.
	for (const [key, value] of Object.entries(values))
		if (fields.get(key)?.type === "secret" && value) registerSecret(value);

	if (input.schedule !== undefined && !SYNC_SCHEDULES.includes(input.schedule))
		return { status: "invalid", message: "Unknown sync schedule." };
	for (const [key, value] of Object.entries(values)) {
		const field = fields.get(key);
		if (!field)
			return {
				status: "invalid",
				message: `${provider.label} has no "${key}" setting.`,
			};
		if (value === undefined) continue;
		if (typeof value !== "string")
			return { status: "invalid", message: `${field.label} must be text.` };
		const trimmed = value.trim();
		const problem = trimmed ? checkValue(field, trimmed) : null;
		if (problem) return { status: "invalid", message: problem };
	}

	const [old] = await db
		.select()
		.from(progressProviders)
		.where(eq(progressProviders.kind, kind));

	const config: Record<string, string> = { ...(old?.config ?? {}) };
	const newSecrets: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) continue;
		const field = fields.get(key) as ConfigField;
		const trimmed = value.trim();
		if (field.type === "secret") {
			if (trimmed) newSecrets[key] = trimmed;
		} else if (trimmed) config[key] = trimmed;
		else delete config[key];
	}

	let encrypted: {
		secretsCiphertext: Buffer | null;
		secretsIv: Buffer | null;
		secretsTag: Buffer | null;
		secretKeyId: string | null;
	} = {
		secretsCiphertext: old?.secretsCiphertext ?? null,
		secretsIv: old?.secretsIv ?? null,
		secretsTag: old?.secretsTag ?? null,
		secretKeyId: old?.secretKeyId ?? null,
	};
	if (Object.keys(newSecrets).length > 0) {
		// Unreadable old secrets are dropped; the view then shows them unset.
		const merged = { ...(old ? readSecrets(old, secret) : {}), ...newSecrets };
		const e = credentialCrypto(secret).encrypt(
			aad(kind),
			JSON.stringify(merged),
		);
		encrypted = {
			secretsCiphertext: e.apiKeyCiphertext,
			secretsIv: e.apiKeyIv,
			secretsTag: e.apiKeyTag,
			secretKeyId: e.secretKeyId,
		};
	}

	const record = {
		enabled: input.enabled ?? old?.enabled ?? false,
		schedule: input.schedule ?? old?.schedule ?? "manual",
		config,
		...encrypted,
	};
	const [saved] = old
		? await db
				.update(progressProviders)
				.set({ ...record, updatedAt: sql`now()` })
				.where(eq(progressProviders.kind, kind))
				.returning()
		: await db
				.insert(progressProviders)
				.values({
					kind,
					...record,
					priority: sql`(select coalesce(max(${progressProviders.priority}), 0) + 1 from ${progressProviders})`,
				})
				.returning();
	return { status: "ok", provider: view(kind, saved, secret) };
}
