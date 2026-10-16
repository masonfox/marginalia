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

export const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** USD per million tokens. A missing cache price falls back to the input price. */
export interface ModelPrice {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
}

const PRICES_FORMAT =
	'must be JSON like {"<model>": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75}} with non-negative USD per million tokens';

const priceSchema = z
	.object({
		input: z.number().nonnegative(),
		output: z.number().nonnegative(),
		cacheRead: z.number().nonnegative().optional(),
		cacheWrite: z.number().nonnegative().optional(),
	})
	.strict();

/** Parses AI_PRICES. The issue states the expected format only, never the value. */
function parsePrices(
	raw: string,
	ctx: z.RefinementCtx<string>,
): Record<string, ModelPrice> {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		json = undefined;
	}
	const parsed = z.record(z.string().min(1), priceSchema).safeParse(json);
	if (!parsed.success) {
		ctx.addIssue({ code: "custom", message: PRICES_FORMAT });
		return z.NEVER;
	}
	return parsed.data;
}

export const AI_PROVIDERS = [
	"openai",
	"anthropic",
	"google",
	"openai-compatible",
] as const;

export type AiProviderName = (typeof AI_PROVIDERS)[number];

const baseUrl = () =>
	optional(
		z
			.url({
				protocol: /^https?$/,
				error: "must be an absolute http(s) URL",
			})
			.optional(),
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
	AI_PROVIDER: optional(
		z
			.enum(AI_PROVIDERS, {
				error: "must be openai, anthropic, google, or openai-compatible",
			})
			.optional(),
	),
	AI_MODEL: optional(z.string().optional()),
	AI_API_KEY: optional(z.string().optional()),
	AI_BASE_URL: baseUrl(),
	AI_OPENAI_API_KEY: optional(z.string().optional()),
	AI_OPENAI_BASE_URL: baseUrl(),
	AI_ANTHROPIC_API_KEY: optional(z.string().optional()),
	AI_ANTHROPIC_BASE_URL: baseUrl(),
	AI_GOOGLE_API_KEY: optional(z.string().optional()),
	AI_GOOGLE_BASE_URL: baseUrl(),
	AI_OPENAI_COMPATIBLE_BASE_URL: baseUrl(),
	AI_OPENAI_COMPATIBLE_API_KEY: optional(z.string().optional()),
	AI_MAX_STEPS: integer(1, 8, "a positive whole number"),
	AI_TEMPERATURE: optional(
		z.coerce
			.number({ error: "must be a number between 0 and 2" })
			.min(0, { error: "must be a number between 0 and 2" })
			.max(2, { error: "must be a number between 0 and 2" })
			.optional(),
	),
	AI_EFFORT: optional(
		z
			.enum(REASONING_EFFORTS, {
				error: `must be one of ${REASONING_EFFORTS.join(", ")}`,
			})
			.optional(),
	),
	AI_PROMPT_CACHE: boolean(true),
	AI_PRICES: optional(z.string().transform(parsePrices).optional()),
	AI_PREPROCESS_MODEL: optional(z.string().optional()),
	AI_PREPROCESS_AUTO: boolean(false),
	LOG_LEVEL: optional(
		z
			.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"], {
				error: "must be one of fatal, error, warn, info, debug, trace, silent",
			})
			.default("info"),
	),
});

/** A provider and one of its model ids. */
export interface AiSelection {
	provider: AiProviderName;
	model: string;
}

/** How to reach one provider. Never log `apiKey`. */
export interface AiCredentials {
	apiKey: string | undefined;
	baseUrl: string | undefined;
}

/** Language model settings. Never log the API keys in `credentials`. */
export interface AiConfig {
	/** Providers with usable credentials. A provider is available when it has an entry. */
	credentials: Partial<Record<AiProviderName, AiCredentials>>;
	/** Defaults from AI_PROVIDER with AI_MODEL and AI_PREPROCESS_MODEL. */
	envDefaults: {
		chat?: AiSelection;
		/** Unset means preprocessing follows the chat default. */
		preprocess?: AiSelection;
	};
	maxSteps: number;
	temperature: number | undefined;
	/** Undefined means the provider's default. */
	effort: ReasoningEffort | undefined;
	promptCache: boolean;
	/** Price overrides from AI_PRICES, keyed by model id. */
	prices: Record<string, ModelPrice>;
}

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
	/** Preprocess books automatically after ingest (AI_PREPROCESS_AUTO). */
	preprocessAuto: boolean;
	/** AI is disabled when `ai.credentials` is empty. */
	ai: AiConfig;
	/** Ignored settings to log at startup. They name variables only, never values. */
	warnings: string[];
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
	const { ai, warnings } = buildAiConfig(e);
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
		preprocessAuto: e.AI_PREPROCESS_AUTO,
		ai,
		warnings,
	};
}

type Env = z.infer<typeof envSchema>;

/** The per-provider credential variables. */
const PROVIDER_VARS = {
	openai: { apiKey: "AI_OPENAI_API_KEY", baseUrl: "AI_OPENAI_BASE_URL" },
	anthropic: {
		apiKey: "AI_ANTHROPIC_API_KEY",
		baseUrl: "AI_ANTHROPIC_BASE_URL",
	},
	google: { apiKey: "AI_GOOGLE_API_KEY", baseUrl: "AI_GOOGLE_BASE_URL" },
	"openai-compatible": {
		apiKey: "AI_OPENAI_COMPATIBLE_API_KEY",
		baseUrl: "AI_OPENAI_COMPATIBLE_BASE_URL",
	},
} as const satisfies Record<
	AiProviderName,
	{ apiKey: keyof Env; baseUrl: keyof Env }
>;

/**
 * Cross-field validation for the AI variables. AI_PROVIDER with AI_API_KEY and
 * AI_BASE_URL supplies the credentials of the provider it names. Messages name
 * variables only, never values.
 */
function buildAiConfig(e: Env): { ai: AiConfig; warnings: string[] } {
	const issues: string[] = [];
	const warnings: string[] = [];
	const credentials: AiConfig["credentials"] = {};
	const legacy = e.AI_PROVIDER;
	const legacySet = (["AI_API_KEY", "AI_BASE_URL"] as const).filter(
		(name) => e[name] !== undefined,
	);

	for (const provider of AI_PROVIDERS) {
		const vars = PROVIDER_VARS[provider];
		const ownSet = [vars.apiKey, vars.baseUrl].filter(
			(name) => e[name] !== undefined,
		);
		let c: AiCredentials = { apiKey: e[vars.apiKey], baseUrl: e[vars.baseUrl] };
		if (provider === legacy && legacySet.length > 0) {
			if (ownSet.length > 0) {
				issues.push(
					`${[...legacySet, ...ownSet].join(" and ")} both set credentials for ${provider}; use either the AI_PROVIDER variables or ${vars.apiKey}/${vars.baseUrl}`,
				);
				continue;
			}
			c = { apiKey: e.AI_API_KEY, baseUrl: e.AI_BASE_URL };
		}
		if (provider === "openai-compatible") {
			if (c.baseUrl !== undefined) credentials[provider] = c;
			else if (provider !== legacy && c.apiKey !== undefined) {
				warnings.push(`${vars.apiKey} is ignored without ${vars.baseUrl}`);
			}
		} else if (c.apiKey !== undefined) {
			credentials[provider] = c;
		} else if (e[vars.baseUrl] !== undefined) {
			issues.push(`${vars.baseUrl} requires ${vars.apiKey} to be set`);
		}
	}

	const envDefaults: AiConfig["envDefaults"] = {};
	if (legacy === undefined) {
		if (e.AI_PREPROCESS_MODEL !== undefined) {
			issues.push("AI_PREPROCESS_MODEL requires AI_PROVIDER to be set");
		}
		for (const name of ["AI_MODEL", "AI_API_KEY", "AI_BASE_URL"] as const) {
			if (e[name] !== undefined) {
				warnings.push(`${name} is ignored because AI_PROVIDER is not set`);
			}
		}
	} else {
		const vars = PROVIDER_VARS[legacy];
		const duplicated =
			legacySet.length > 0 &&
			(e[vars.apiKey] !== undefined || e[vars.baseUrl] !== undefined);
		if (e.AI_MODEL === undefined) {
			issues.push("AI_MODEL is required when AI_PROVIDER is set");
		} else {
			envDefaults.chat = { provider: legacy, model: e.AI_MODEL };
		}
		if (!duplicated && credentials[legacy] === undefined) {
			issues.push(
				legacy === "openai-compatible"
					? `AI_BASE_URL or ${vars.baseUrl} is required when AI_PROVIDER is openai-compatible`
					: `AI_API_KEY or ${vars.apiKey} is required when AI_PROVIDER is ${legacy}`,
			);
		}
		if (e.AI_PREPROCESS_MODEL !== undefined) {
			envDefaults.preprocess = {
				provider: legacy,
				model: e.AI_PREPROCESS_MODEL,
			};
		}
	}

	if (e.AI_PREPROCESS_AUTO && Object.keys(credentials).length === 0) {
		issues.push(
			"AI_PREPROCESS_AUTO requires credentials for at least one AI provider",
		);
	}
	if (issues.length > 0) throw new ConfigError(issues);
	return {
		ai: {
			credentials,
			envDefaults,
			maxSteps: e.AI_MAX_STEPS,
			temperature: e.AI_TEMPERATURE,
			effort: e.AI_EFFORT,
			promptCache: e.AI_PROMPT_CACHE,
			prices: e.AI_PRICES ?? {},
		},
		warnings,
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
	const { authPassword, databaseUrl, ai, warnings: _, ...rest } = config;
	return {
		...rest,
		ai: {
			providers: Object.fromEntries(
				Object.entries(ai.credentials).map(([provider, c]) => [
					provider,
					{ baseUrl: c.baseUrl, apiKeySet: c.apiKey !== undefined },
				]),
			),
			envDefaults: ai.envDefaults,
			maxSteps: ai.maxSteps,
			temperature: ai.temperature,
			effort: ai.effort,
			promptCache: ai.promptCache,
			prices: ai.prices,
		},
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
