import { z } from "zod";

/** Treat empty strings as unset so `VAR=` in Compose or `.env` means "use the default". */
const optional = <T extends z.ZodType>(schema: T) =>
	z.preprocess((v) => (v === "" ? undefined : v), schema);

const integer = (min: number, fallback: number, description: string) =>
	optional(
		z.coerce
			.number({ error: `must be ${description}` })
			.int({ error: `must be ${description}` })
			.min(min, { error: `must be ${description}` })
			.default(fallback),
	);

const boolean = (fallback: boolean) =>
	optional(
		z
			.enum(["true", "false", "1", "0", "yes", "no"], {
				error: "must be true or false",
			})
			.default(fallback ? "true" : "false")
			.transform((v) => v === "true" || v === "1" || v === "yes"),
	);

export const envSchema = z.object({
	DATABASE_URL: optional(
		z.string({ error: "is required (a PostgreSQL connection string)" }),
	),
	PORT: integer(1, 3000, "a port number"),
	MARGINALIA_DATA_DIR: optional(z.string().default("/data")),
	MARGINALIA_LIBRARY_PATHS: optional(
		z
			.string()
			.default("")
			.transform((v) =>
				v
					.split(",")
					.map((p) => p.trim())
					.filter((p) => p.length > 0),
			),
	),
	MARGINALIA_SCAN_INTERVAL_MINUTES: integer(
		0,
		60,
		"a whole number of minutes (0 disables scheduled scans)",
	),
	MARGINALIA_MAX_UPLOAD_MB: integer(1, 200, "a positive whole number"),
	MARGINALIA_WORKER: boolean(true),
	MARGINALIA_ROLE: optional(
		z
			.enum(["all", "web", "worker"], { error: "must be all, web, or worker" })
			.default("all"),
	),
	MARGINALIA_INGEST_CONCURRENCY: integer(1, 2, "a positive whole number"),
	MARGINALIA_PUBLIC_URL: optional(
		z
			.url({
				protocol: /^https?$/,
				error: "must be an absolute http(s) URL",
			})
			.transform((v) => v.replace(/\/+$/, ""))
			.optional(),
	),
	AUTH_PASSWORD: optional(z.string().optional()),
	MARGINALIA_SESSION_DAYS: integer(1, 30, "a positive whole number of days"),
	MARGINALIA_TRUST_PROXY: boolean(false),
	LOG_LEVEL: optional(
		z
			.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"], {
				error: "must be one of fatal, error, warn, info, debug, trace, silent",
			})
			.default("info"),
	),
});

export interface Config {
	databaseUrl: string;
	port: number;
	dataDir: string;
	libraryPaths: string[];
	scanIntervalMinutes: number;
	maxUploadMb: number;
	/** Whether this process runs background jobs. */
	worker: boolean;
	role: "all" | "web" | "worker";
	ingestConcurrency: number;
	publicUrl: string | undefined;
	/** Set and non-empty → login required. Never log or send this value. */
	authPassword: string | undefined;
	sessionDays: number;
	trustProxy: boolean;
	logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

export class ConfigError extends Error {
	constructor(readonly issues: string[]) {
		super(
			`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
		);
		this.name = "ConfigError";
	}
}

/**
 * Validates environment variables. Throws a ConfigError naming every invalid or
 * missing variable. Messages are built from variable names and expected formats
 * only, so secret values never appear in them.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
	const result = envSchema.safeParse(env);
	if (!result.success) {
		throw new ConfigError(
			result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`),
		);
	}
	const e = result.data;
	return {
		databaseUrl: e.DATABASE_URL,
		port: e.PORT,
		dataDir: e.MARGINALIA_DATA_DIR,
		libraryPaths: e.MARGINALIA_LIBRARY_PATHS,
		scanIntervalMinutes: e.MARGINALIA_SCAN_INTERVAL_MINUTES,
		maxUploadMb: e.MARGINALIA_MAX_UPLOAD_MB,
		worker: e.MARGINALIA_WORKER,
		role: e.MARGINALIA_ROLE,
		ingestConcurrency: e.MARGINALIA_INGEST_CONCURRENCY,
		publicUrl: e.MARGINALIA_PUBLIC_URL,
		authPassword: e.AUTH_PASSWORD,
		sessionDays: e.MARGINALIA_SESSION_DAYS,
		trustProxy: e.MARGINALIA_TRUST_PROXY,
		logLevel: e.LOG_LEVEL,
	};
}

/** Whether this process should run background jobs, combining MARGINALIA_WORKER and MARGINALIA_ROLE. */
export function runsWorker(config: Config): boolean {
	return config.role !== "web" && config.worker;
}

/** Whether this process should serve the web UI and API (beyond the health check). */
export function servesWeb(config: Config): boolean {
	return config.role !== "worker";
}

/** A loggable view of the config: secrets are replaced by whether they are set. */
export function redactedConfig(config: Config) {
	const { authPassword, databaseUrl, ...rest } = config;
	return {
		...rest,
		databaseUrl: redactUrlPassword(databaseUrl),
		authEnabled: authPassword !== undefined,
	};
}

function redactUrlPassword(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.password) parsed.password = "***";
		return parsed.toString();
	} catch {
		return "<unparseable>";
	}
}

let cached: Config | undefined;

/** The process-wide config, loaded from process.env on first use. */
export function getConfig(): Config {
	cached ??= loadConfig(process.env);
	return cached;
}
