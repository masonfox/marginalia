import { sql } from "drizzle-orm";
import type { Executor } from "#/server/db";

/** ISO 639-1 primary language → PostgreSQL built-in text search configuration. */
const CONFIG_BY_LANGUAGE: Record<string, string> = {
	ar: "arabic",
	ca: "catalan",
	da: "danish",
	de: "german",
	el: "greek",
	en: "english",
	es: "spanish",
	eu: "basque",
	fi: "finnish",
	fr: "french",
	ga: "irish",
	hi: "hindi",
	hu: "hungarian",
	hy: "armenian",
	id: "indonesian",
	it: "italian",
	lt: "lithuanian",
	nb: "norwegian",
	ne: "nepali",
	nl: "dutch",
	nn: "norwegian",
	no: "norwegian",
	pt: "portuguese",
	ro: "romanian",
	ru: "russian",
	sr: "serbian",
	sv: "swedish",
	ta: "tamil",
	tr: "turkish",
	yi: "yiddish",
};

export const FALLBACK_SEARCH_CONFIG = "simple";

/** The configuration for a `dc:language` value, if the server has it; otherwise `simple`. */
export async function resolveSearchConfig(
	db: Executor,
	language: string | null,
): Promise<string> {
	const primary = language?.trim().toLowerCase().split(/[-_]/)[0];
	const candidate = primary ? CONFIG_BY_LANGUAGE[primary] : undefined;
	if (!candidate) return FALLBACK_SEARCH_CONFIG;
	const result = await db.execute<{ exists: boolean }>(
		sql`select exists(select 1 from pg_ts_config where cfgname = ${candidate}) as exists`,
	);
	return result.rows[0]?.exists ? candidate : FALLBACK_SEARCH_CONFIG;
}
