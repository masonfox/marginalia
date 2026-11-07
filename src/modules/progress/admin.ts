// What the Settings page's "Reading sync" section needs beyond the config
// store: providers in priority order with their form metadata, reordering,
// testing unsaved values, and the unmatched list.
import { asc, eq, sql } from "drizzle-orm";
import { maskSecrets, registerSecret } from "#/modules/ai";
import { editions } from "#/modules/library";
import type { Database, Executor } from "#/server/db";
import {
	listProviderConfigs,
	loadProviderConfig,
	type ProviderConfigView,
} from "./config-store";
import { manualLink } from "./matching";
import { getProvider } from "./registry";
import { progressProviders, progressUnmatched } from "./schema";
import {
	type ConfigField,
	PROVIDER_KINDS,
	type ProgressProvider,
	type ProviderKind,
	type StoredReading,
	type TestResult,
} from "./types";

/** A provider's settings with the metadata its generated form needs. */
export interface ProviderSettingsView extends ProviderConfigView {
	configFields: ConfigField[];
	help: string | null;
	mode: "list" | "lookup";
}

/**
 * Every built-in provider, saved or not, in priority order (highest first).
 * Providers never saved come last, in registry order.
 */
export async function listProviderSettings(
	db: Executor,
	secret: string,
): Promise<ProviderSettingsView[]> {
	const views = await listProviderConfigs(db, secret);
	const rank = (v: ProviderConfigView) => v.priority ?? Number.MAX_SAFE_INTEGER;
	return views
		.map((v, i) => ({ v, i }))
		.sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
		.map(({ v }) => {
			const provider = getProvider(v.kind);
			return {
				...v,
				configFields: provider.configFields,
				help: provider.help ?? null,
				mode: provider.matching.mode,
			};
		});
}

export type ReorderResult = { status: "ok" } | { status: "invalid" };

/**
 * Sets the provider priority order, highest first. `order` must name every
 * provider kind once. Providers never saved get a row (disabled, empty
 * config) so they keep their place. `priority` is a plain unique column, so
 * every row first moves to a temporary negative value, then to its place,
 * in one transaction.
 */
export async function setProviderOrder(
	db: Database,
	order: readonly ProviderKind[],
): Promise<ReorderResult> {
	if (
		order.length !== PROVIDER_KINDS.length ||
		new Set(order).size !== order.length ||
		!order.every((k) => (PROVIDER_KINDS as readonly string[]).includes(k))
	)
		return { status: "invalid" };
	await db.transaction(async (tx) => {
		// Serializes concurrent reorders and inserts of new provider rows.
		await tx.execute(
			sql`lock table ${progressProviders} in share row exclusive mode`,
		);
		const rows = await tx
			.select({ kind: progressProviders.kind })
			.from(progressProviders);
		const missing = order.filter((k) => !rows.some((r) => r.kind === k));
		const [max] = await tx
			.select({
				max: sql<number>`coalesce(max(${progressProviders.priority}), 0)`,
			})
			.from(progressProviders);
		if (missing.length > 0)
			await tx.insert(progressProviders).values(
				missing.map((kind, i) => ({
					kind,
					priority: Number(max?.max ?? 0) + 1 + i,
				})),
			);
		for (const [i, kind] of order.entries())
			await tx
				.update(progressProviders)
				.set({ priority: -(i + 1) })
				.where(eq(progressProviders.kind, kind));
		for (const [i, kind] of order.entries())
			await tx
				.update(progressProviders)
				.set({ priority: i + 1 })
				.where(eq(progressProviders.kind, kind));
	});
	return { status: "ok" };
}

export type ConnectionTestResult =
	| (TestResult & { message: string })
	| { status: "invalid"; message: string };

const MAX_DETAIL_LENGTH = 200;

/** The reader-facing sentence for a test result. */
export function testResultMessage(label: string, result: TestResult): string {
	switch (result.status) {
		case "ok":
			return `${label} accepted the credentials.`;
		case "unreachable":
			return `${label} could not be reached. Check its address and that it is running.`;
		case "rejected":
			return `${label} rejected the credentials.`;
		case "rate-limited":
			return `${label} is rate limiting requests. Try again in a minute.`;
	}
}

/**
 * Details that only say again what the status's message says, such as
 * "Unauthorized" or "Hardcover rejected the API token" under "Hardcover
 * rejected the credentials.": not shown, so the reason reads once.
 */
const RESTATED: Record<TestResult["status"], RegExp | null> = {
	ok: null,
	rejected:
		/^(unauthori[sz]ed|forbidden|invalid credentials|http 40[13]|.* rejected the (credentials|api token|api key|password))\.?$/i,
	unreachable: /^.* could not be reached\.?$/i,
	"rate-limited":
		/^(too many requests|rate limited|http 429|.* is rate limiting requests)\.?$/i,
};

/** True when a test result's detail adds nothing to its message. */
export function restatesStatus(result: TestResult): boolean {
	const pattern = RESTATED[result.status];
	return !!pattern && !!result.detail && pattern.test(result.detail.trim());
}

/**
 * Tests a provider with the form's unsaved values merged over its saved
 * configuration. A blank or omitted secret uses the saved one; a plain field
 * that is given replaces the saved value (blank clears it). Nothing is
 * stored. Secrets never appear in the result.
 */
export async function testProviderConnection(
	db: Executor,
	secret: string,
	kind: ProviderKind,
	values: Record<string, string | undefined>,
	provider: ProgressProvider = getProvider(kind),
): Promise<ConnectionTestResult> {
	const fields = new Map(provider.configFields.map((f) => [f.key, f]));
	for (const [key, value] of Object.entries(values))
		if (fields.get(key)?.type === "secret" && value) registerSecret(value);
	const loaded = await loadProviderConfig(db, secret, kind);
	const cfg: Record<string, string> =
		loaded.status === "ok" ? { ...loaded.config } : {};
	if (loaded.status === "unreadable") {
		// Plain fields are still readable; secrets must be entered again.
		const [row] = await db
			.select({ config: progressProviders.config })
			.from(progressProviders)
			.where(eq(progressProviders.kind, kind));
		Object.assign(cfg, row?.config ?? {});
	}
	for (const [key, raw] of Object.entries(values)) {
		const field = fields.get(key);
		if (!field || raw === undefined) continue;
		const value = raw.trim();
		if (field.type === "secret") {
			if (value) cfg[key] = value;
		} else if (value) cfg[key] = value;
		else delete cfg[key];
	}
	for (const field of provider.configFields) {
		const value = cfg[field.key];
		if (field.required && !value)
			return { status: "invalid", message: `${field.label} is required.` };
		if (value && field.type === "url" && !isHttpUrl(value))
			return {
				status: "invalid",
				message: `${field.label} must be an absolute http(s) URL.`,
			};
	}
	let result: TestResult;
	try {
		result = await provider.testConnection(cfg);
	} catch (err) {
		result = {
			status: "unreachable",
			detail: err instanceof Error ? err.message : String(err),
		};
	}
	const detail =
		result.detail && !restatesStatus(result)
			? maskSecrets(result.detail).slice(0, MAX_DETAIL_LENGTH)
			: undefined;
	return {
		...result,
		detail,
		message: testResultMessage(provider.label, result),
	};
}

function isHttpUrl(value: string): boolean {
	try {
		return ["http:", "https:"].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}

/** A provider book being read that is linked to no edition. */
export interface UnmatchedBook {
	providerKind: ProviderKind;
	externalId: string;
	title: string;
	authors: string[];
	isbns: string[];
	reading: StoredReading;
	seenAt: Date;
}

/**
 * Links a provider book to an edition by hand (`manualLink`), after checking
 * the edition and the provider's settings row exist.
 */
export async function linkBookByHand(
	db: Database,
	kind: ProviderKind,
	externalId: string,
	editionId: string,
): Promise<{ status: "ok" | "not-found" }> {
	const [[edition], [provider]] = await Promise.all([
		db
			.select({ id: editions.id })
			.from(editions)
			.where(eq(editions.id, editionId)),
		db
			.select({ kind: progressProviders.kind })
			.from(progressProviders)
			.where(eq(progressProviders.kind, kind)),
	]);
	if (!edition || !provider) return { status: "not-found" };
	await manualLink(db, kind, externalId, editionId);
	return { status: "ok" };
}

/** Every provider's unmatched books, by title. */
export async function listUnmatched(db: Executor): Promise<UnmatchedBook[]> {
	return db
		.select()
		.from(progressUnmatched)
		.orderBy(asc(progressUnmatched.title), asc(progressUnmatched.externalId));
}
