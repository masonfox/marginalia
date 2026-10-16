import { describe, expect, it } from "vitest";
import { createAi } from "#/modules/ai";
import {
	ConfigError,
	loadConfig,
	redactedConfig,
	runsWorker,
	servesWeb,
} from "./config";

const base = { DATABASE_URL: "postgres://u:dbsecret@localhost:5432/m" };

function errorOf(env: Record<string, string | undefined>): ConfigError {
	try {
		loadConfig(env);
	} catch (e) {
		if (e instanceof ConfigError) return e;
		throw e;
	}
	throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
	it("applies defaults", () => {
		const c = loadConfig(base);
		expect(c).toMatchObject({
			port: 3000,
			dataDir: "/data",
			libraryPaths: [],
			scanIntervalMinutes: 60,
			maxUploadMb: 200,
			worker: true,
			role: "all",
			ingestConcurrency: 2,
			publicUrl: undefined,
			authPassword: undefined,
			sessionDays: 30,
			trustProxy: false,
			logLevel: "info",
		});
	});

	it("names a missing DATABASE_URL", () => {
		const err = errorOf({});
		expect(err.issues).toEqual([
			"DATABASE_URL is required (a PostgreSQL connection string)",
		]);
	});

	it("treats an empty DATABASE_URL as missing", () => {
		expect(errorOf({ DATABASE_URL: "" }).message).toContain("DATABASE_URL");
	});

	it("names a non-numeric MARGINALIA_MAX_UPLOAD_MB and its expected format", () => {
		const err = errorOf({ ...base, MARGINALIA_MAX_UPLOAD_MB: "lots" });
		expect(err.issues).toEqual([
			"MARGINALIA_MAX_UPLOAD_MB must be a positive whole number",
		]);
	});

	it("rejects a zero or negative upload size", () => {
		expect(
			errorOf({ ...base, MARGINALIA_MAX_UPLOAD_MB: "0" }).message,
		).toContain("MARGINALIA_MAX_UPLOAD_MB");
	});

	it("reports every invalid variable at once", () => {
		const err = errorOf({
			MARGINALIA_MAX_UPLOAD_MB: "x",
			MARGINALIA_ROLE: "admin",
			MARGINALIA_WORKER: "maybe",
		});
		const names = err.issues.map((i) => i.split(" ")[0]);
		expect(names.sort()).toEqual([
			"DATABASE_URL",
			"MARGINALIA_MAX_UPLOAD_MB",
			"MARGINALIA_ROLE",
			"MARGINALIA_WORKER",
		]);
	});

	it("parses library paths and booleans", () => {
		const c = loadConfig({
			...base,
			MARGINALIA_LIBRARY_PATHS: " /books , /more,, ",
			MARGINALIA_WORKER: "false",
			MARGINALIA_TRUST_PROXY: "1",
			MARGINALIA_SCAN_INTERVAL_MINUTES: "0",
			MARGINALIA_PUBLIC_URL: "https://books.example.com/",
		});
		expect(c.libraryPaths).toEqual(["/books", "/more"]);
		expect(c.worker).toBe(false);
		expect(c.trustProxy).toBe(true);
		expect(c.scanIntervalMinutes).toBe(0);
		expect(c.publicUrl).toBe("https://books.example.com");
	});

	it("derives the process role from MARGINALIA_ROLE and MARGINALIA_WORKER", () => {
		const role = (env: Record<string, string>) => {
			const c = loadConfig({ ...base, ...env });
			return { worker: runsWorker(c), web: servesWeb(c) };
		};
		expect(role({})).toEqual({ worker: true, web: true });
		expect(role({ MARGINALIA_WORKER: "false" })).toEqual({
			worker: false,
			web: true,
		});
		expect(role({ MARGINALIA_ROLE: "web" })).toEqual({
			worker: false,
			web: true,
		});
		expect(role({ MARGINALIA_ROLE: "worker" })).toEqual({
			worker: true,
			web: false,
		});
	});

	describe("AUTH_PASSWORD", () => {
		it("enables auth when non-empty", () => {
			const c = loadConfig({ ...base, AUTH_PASSWORD: "correct horse" });
			expect(c.authPassword).toBe("correct horse");
			expect(redactedConfig(c).authEnabled).toBe(true);
		});

		it("disables auth when unset", () => {
			expect(loadConfig(base).authPassword).toBeUndefined();
		});

		it("disables auth when empty", () => {
			const c = loadConfig({ ...base, AUTH_PASSWORD: "" });
			expect(c.authPassword).toBeUndefined();
			expect(redactedConfig(c).authEnabled).toBe(false);
		});

		it("never appears in error output", () => {
			const secret = "hunter2-very-secret";
			const err = errorOf({
				AUTH_PASSWORD: secret,
				MARGINALIA_MAX_UPLOAD_MB: secret,
				MARGINALIA_SESSION_DAYS: secret,
			});
			expect(err.message).not.toContain(secret);
			expect(JSON.stringify(err)).not.toContain(secret);
			expect(String(err.stack)).not.toContain(secret);
		});

		it("never appears in the loggable config", () => {
			const c = loadConfig({ ...base, AUTH_PASSWORD: "hunter2-very-secret" });
			const logged = JSON.stringify(redactedConfig(c));
			expect(logged).not.toContain("hunter2-very-secret");
			expect(logged).not.toContain("dbsecret");
		});
	});

	describe("AI provider", () => {
		it("is disabled when no provider has credentials", () => {
			const c = loadConfig(base);
			expect(c.ai.credentials).toEqual({});
			expect(c.ai.envDefaults).toEqual({});
			expect(c.warnings).toEqual([]);
			expect(redactedConfig(c).ai.providers).toEqual({});
		});

		it("loads a hosted provider through AI_PROVIDER with defaults", () => {
			const c = loadConfig({
				...base,
				AI_PROVIDER: "anthropic",
				AI_MODEL: "claude-x",
				AI_API_KEY: "k",
			});
			expect(c.ai).toEqual({
				credentials: { anthropic: { apiKey: "k", baseUrl: undefined } },
				envDefaults: { chat: { provider: "anthropic", model: "claude-x" } },
				maxSteps: 8,
				temperature: undefined,
				effort: undefined,
				promptCache: true,
				prices: {},
			});
		});

		const anthropic = {
			...base,
			AI_PROVIDER: "anthropic",
			AI_MODEL: "claude-x",
			AI_API_KEY: "k",
		};

		it.each([
			["openai", "AI_OPENAI_API_KEY", "AI_OPENAI_BASE_URL"],
			["anthropic", "AI_ANTHROPIC_API_KEY", "AI_ANTHROPIC_BASE_URL"],
			["google", "AI_GOOGLE_API_KEY", "AI_GOOGLE_BASE_URL"],
		] as const)("loads %s credentials from its own variables", (provider, key, url) => {
			expect(loadConfig({ ...base, [key]: "k" }).ai.credentials).toEqual({
				[provider]: { apiKey: "k", baseUrl: undefined },
			});
			const c = loadConfig({ ...base, [key]: "k", [url]: "https://p.test/v1" });
			expect(c.ai.credentials).toEqual({
				[provider]: { apiKey: "k", baseUrl: "https://p.test/v1" },
			});
			// Credentials alone give no default model.
			expect(c.ai.envDefaults).toEqual({});
		});

		it("loads an OpenAI-compatible endpoint with or without a key", () => {
			const url = "http://localhost:11434/v1";
			expect(
				loadConfig({ ...base, AI_OPENAI_COMPATIBLE_BASE_URL: url }).ai
					.credentials,
			).toEqual({ "openai-compatible": { apiKey: undefined, baseUrl: url } });
			expect(
				loadConfig({
					...base,
					AI_OPENAI_COMPATIBLE_BASE_URL: url,
					AI_OPENAI_COMPATIBLE_API_KEY: "k",
				}).ai.credentials,
			).toEqual({ "openai-compatible": { apiKey: "k", baseUrl: url } });
		});

		it("loads several providers at once", () => {
			const c = loadConfig({
				...anthropic,
				AI_OPENAI_API_KEY: "ok",
				AI_GOOGLE_API_KEY: "gk",
				AI_OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1",
			});
			expect(Object.keys(c.ai.credentials).sort()).toEqual([
				"anthropic",
				"google",
				"openai",
				"openai-compatible",
			]);
			expect(c.ai.credentials.anthropic?.apiKey).toBe("k");
			expect(c.ai.credentials.openai?.apiKey).toBe("ok");
			expect(c.ai.envDefaults.chat).toEqual({
				provider: "anthropic",
				model: "claude-x",
			});
		});

		it("maps AI_PROVIDER onto the credentials of the provider it names", () => {
			const c = loadConfig({
				...base,
				AI_PROVIDER: "openai-compatible",
				AI_MODEL: "llama3",
				AI_BASE_URL: "http://localhost:11434/v1",
				AI_API_KEY: "k",
				AI_PREPROCESS_MODEL: "small",
			});
			expect(c.ai.credentials).toEqual({
				"openai-compatible": {
					apiKey: "k",
					baseUrl: "http://localhost:11434/v1",
				},
			});
			expect(c.ai.envDefaults).toEqual({
				chat: { provider: "openai-compatible", model: "llama3" },
				preprocess: { provider: "openai-compatible", model: "small" },
			});
		});

		it("accepts AI_PROVIDER with the provider's own key", () => {
			const c = loadConfig({
				...base,
				AI_PROVIDER: "google",
				AI_MODEL: "gemini-x",
				AI_GOOGLE_API_KEY: "gk",
			});
			expect(c.ai.credentials).toEqual({
				google: { apiKey: "gk", baseUrl: undefined },
			});
			expect(c.ai.envDefaults.chat).toEqual({
				provider: "google",
				model: "gemini-x",
			});
		});

		it("gives an env-only config the same models as before", () => {
			const c = loadConfig(anthropic);
			expect(c.ai.envDefaults.chat).toEqual({
				provider: "anthropic",
				model: "claude-x",
			});
			// No preprocess default means preprocessing follows the chat model.
			expect(c.ai.envDefaults.preprocess).toBeUndefined();
			expect(createAi(c.ai).status).toEqual({
				enabled: true,
				provider: "anthropic",
				model: "claude-x",
				preprocessModel: "claude-x",
			});
		});

		it("loads effort, caching, and price overrides", () => {
			const c = loadConfig({
				...anthropic,
				AI_EFFORT: "low",
				AI_PROMPT_CACHE: "false",
				AI_PRICES:
					'{"claude-x": {"input": 2, "output": 10, "cacheRead": 0.2}, "local": {"input": 0, "output": 0}}',
			});
			expect(c.ai).toMatchObject({
				effort: "low",
				promptCache: false,
				prices: {
					"claude-x": { input: 2, output: 10, cacheRead: 0.2 },
					local: { input: 0, output: 0 },
				},
			});
		});

		it.each([
			["AI_EFFORT", "extreme"],
			["AI_PRICES", "not json"],
			["AI_PRICES", '{"m": {"input": -1, "output": 1}}'],
			["AI_PRICES", '{"m": {"input": 1}}'],
			["AI_PRICES", '{"m": {"input": 1, "output": 1, "cached": 1}}'],
			["AI_PRICES", '[{"input": 1, "output": 1}]'],
			["AI_PROMPT_CACHE", "sometimes"],
		])("names an invalid %s (%s)", (name, value) => {
			const issues = errorOf({ ...anthropic, [name]: value }).issues;
			expect(issues.map((i) => i.split(" ")[0])).toEqual([name]);
		});

		it.each([
			"AI_BASE_URL",
			"AI_OPENAI_BASE_URL",
			"AI_ANTHROPIC_BASE_URL",
			"AI_GOOGLE_BASE_URL",
			"AI_OPENAI_COMPATIBLE_BASE_URL",
		])("names an invalid %s", (name) => {
			const issues = errorOf({
				...base,
				AI_OPENAI_API_KEY: "k",
				AI_ANTHROPIC_API_KEY: "k",
				AI_GOOGLE_API_KEY: "k",
				[name]: "ftp://nope",
			}).issues;
			expect(issues).toEqual([`${name} must be an absolute http(s) URL`]);
		});

		it("allows openai-compatible without a key", () => {
			const c = loadConfig({
				...base,
				AI_PROVIDER: "openai-compatible",
				AI_MODEL: "llama3",
				AI_BASE_URL: "http://localhost:11434/v1",
				AI_TEMPERATURE: "0.7",
				AI_MAX_STEPS: "4",
			});
			expect(c.ai).toMatchObject({
				credentials: {
					"openai-compatible": {
						apiKey: undefined,
						baseUrl: "http://localhost:11434/v1",
					},
				},
				temperature: 0.7,
				maxSteps: 4,
			});
		});

		it("defaults preprocessing off and to the chat default", () => {
			const c = loadConfig(anthropic);
			expect(c.preprocessAuto).toBe(false);
			expect(c.ai.envDefaults.preprocess).toBeUndefined();
		});

		it("loads the preprocess model and auto flag", () => {
			const c = loadConfig({
				...anthropic,
				AI_PREPROCESS_MODEL: "cheap",
				AI_PREPROCESS_AUTO: "true",
			});
			expect(c.preprocessAuto).toBe(true);
			expect(c.ai.envDefaults.preprocess).toEqual({
				provider: "anthropic",
				model: "cheap",
			});
		});

		it("names an invalid AI_PREPROCESS_AUTO", () => {
			expect(
				errorOf({ ...anthropic, AI_PREPROCESS_AUTO: "maybe" }).issues.map(
					(i) => i.split(" ")[0],
				),
			).toEqual(["AI_PREPROCESS_AUTO"]);
		});

		it("names preprocess variables set without a provider", () => {
			expect(
				errorOf({
					...base,
					AI_PREPROCESS_MODEL: "m",
					AI_PREPROCESS_AUTO: "true",
				}).issues,
			).toEqual([
				"AI_PREPROCESS_MODEL requires AI_PROVIDER to be set",
				"AI_PREPROCESS_AUTO requires credentials for at least one AI provider",
			]);
		});

		it("allows AI_PREPROCESS_AUTO with any available provider", () => {
			const c = loadConfig({
				...base,
				AI_ANTHROPIC_API_KEY: "k",
				AI_PREPROCESS_AUTO: "true",
			});
			expect(c.preprocessAuto).toBe(true);
		});

		it("names a missing model", () => {
			expect(
				errorOf({ ...base, AI_PROVIDER: "openai", AI_API_KEY: "k" }).issues,
			).toEqual(["AI_MODEL is required when AI_PROVIDER is set"]);
		});

		it("names a missing key", () => {
			expect(
				errorOf({ ...base, AI_PROVIDER: "google", AI_MODEL: "m" }).issues,
			).toEqual([
				"AI_API_KEY or AI_GOOGLE_API_KEY is required when AI_PROVIDER is google",
			]);
		});

		it("names a missing base URL for openai-compatible", () => {
			expect(
				errorOf({ ...base, AI_PROVIDER: "openai-compatible", AI_MODEL: "m" })
					.issues,
			).toEqual([
				"AI_BASE_URL or AI_OPENAI_COMPATIBLE_BASE_URL is required when AI_PROVIDER is openai-compatible",
			]);
		});

		it.each([
			["AI_ANTHROPIC_API_KEY", "k2"],
			["AI_ANTHROPIC_BASE_URL", "https://p.test"],
		])("refuses AI_API_KEY with %s for the same provider", (name, value) => {
			const issues = errorOf({ ...anthropic, [name]: value }).issues;
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatch(
				new RegExp(
					`^AI_API_KEY and ${name} both set credentials for anthropic`,
				),
			);
			expect(issues[0]).not.toContain(value);
		});

		it("refuses duplicate credentials for openai-compatible", () => {
			const issues = errorOf({
				...base,
				AI_PROVIDER: "openai-compatible",
				AI_MODEL: "m",
				AI_BASE_URL: "http://a.test/v1",
				AI_OPENAI_COMPATIBLE_BASE_URL: "http://b.test/v1",
			}).issues;
			expect(issues).toEqual([
				expect.stringMatching(
					/^AI_BASE_URL and AI_OPENAI_COMPATIBLE_BASE_URL both set credentials/,
				),
			]);
		});

		it("does not treat another provider's variables as duplicates", () => {
			const c = loadConfig({ ...anthropic, AI_OPENAI_API_KEY: "ok" });
			expect(Object.keys(c.ai.credentials).sort()).toEqual([
				"anthropic",
				"openai",
			]);
		});

		it.each([
			["AI_OPENAI_BASE_URL", "AI_OPENAI_API_KEY"],
			["AI_ANTHROPIC_BASE_URL", "AI_ANTHROPIC_API_KEY"],
			["AI_GOOGLE_BASE_URL", "AI_GOOGLE_API_KEY"],
		])("names %s set without %s", (url, key) => {
			expect(errorOf({ ...base, [url]: "https://p.test/v1" }).issues).toEqual([
				`${url} requires ${key} to be set`,
			]);
		});

		it("warns about legacy variables set without AI_PROVIDER", () => {
			const secret = "sk-orphan-secret";
			const c = loadConfig({
				...base,
				AI_MODEL: "m",
				AI_API_KEY: secret,
				AI_BASE_URL: "https://p.test/v1",
			});
			expect(c.ai.credentials).toEqual({});
			expect(c.ai.envDefaults).toEqual({});
			expect(c.warnings).toEqual([
				"AI_MODEL is ignored because AI_PROVIDER is not set",
				"AI_API_KEY is ignored because AI_PROVIDER is not set",
				"AI_BASE_URL is ignored because AI_PROVIDER is not set",
			]);
			expect(JSON.stringify(c.warnings)).not.toContain(secret);
			expect(JSON.stringify(redactedConfig(c))).not.toContain(secret);
		});

		it("warns about an OpenAI-compatible key without its base URL", () => {
			const c = loadConfig({ ...base, AI_OPENAI_COMPATIBLE_API_KEY: "k" });
			expect(c.ai.credentials).toEqual({});
			expect(c.warnings).toEqual([
				"AI_OPENAI_COMPATIBLE_API_KEY is ignored without AI_OPENAI_COMPATIBLE_BASE_URL",
			]);
		});

		it("rejects an unknown provider and bad numbers", () => {
			const names = errorOf({
				...base,
				AI_PROVIDER: "bing",
				AI_MAX_STEPS: "0",
				AI_TEMPERATURE: "hot",
			}).issues.map((i) => i.split(" ")[0]);
			expect(names.sort()).toEqual([
				"AI_MAX_STEPS",
				"AI_PROVIDER",
				"AI_TEMPERATURE",
			]);
		});

		it.each([
			["a missing model", { AI_PROVIDER: "openai", AI_API_KEY: "$" }],
			[
				"duplicate keys",
				{
					AI_PROVIDER: "openai",
					AI_MODEL: "m",
					AI_API_KEY: "$",
					AI_OPENAI_API_KEY: "$-2",
				},
			],
			[
				"a base URL without a key",
				{ AI_GOOGLE_BASE_URL: "https://p.test", AI_ANTHROPIC_BASE_URL: "$" },
			],
			[
				"auto preprocessing without a provider",
				{ AI_OPENAI_COMPATIBLE_API_KEY: "$", AI_PREPROCESS_AUTO: "true" },
			],
		])("never exposes a key in errors for %s", (_, vars) => {
			const secret = "sk-very-secret-key";
			const env = Object.fromEntries(
				Object.entries(vars).map(([k, v]) => [k, v.replace("$", secret)]),
			);
			const err = errorOf({ ...base, ...env });
			expect(err.message).not.toContain(secret);
			expect(JSON.stringify(err)).not.toContain(secret);
			expect(String(err.stack)).not.toContain(secret);
		});

		it("reports apiKeySet per provider and no key in the loggable config", () => {
			const secret = "sk-very-secret-key";
			const c = loadConfig({
				...base,
				AI_PROVIDER: "openai",
				AI_MODEL: "m",
				AI_API_KEY: secret,
				AI_ANTHROPIC_API_KEY: `${secret}-anthropic`,
				AI_OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1",
				AI_EFFORT: "medium",
				AI_PRICES: '{"m": {"input": 1, "output": 2}}',
			});
			const redacted = redactedConfig(c);
			expect(redacted.ai.effort).toBe("medium");
			expect(redacted.ai.providers).toEqual({
				openai: { apiKeySet: true, baseUrl: undefined },
				anthropic: { apiKeySet: true, baseUrl: undefined },
				"openai-compatible": {
					apiKeySet: false,
					baseUrl: "http://localhost:11434/v1",
				},
			});
			expect(JSON.stringify(redacted)).not.toContain(secret);
		});
	});
});
