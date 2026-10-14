import { describe, expect, it } from "vitest";
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
		it("is disabled when AI_PROVIDER is unset", () => {
			const c = loadConfig(base);
			expect(c.ai).toBeUndefined();
			expect(redactedConfig(c).ai).toBeUndefined();
		});

		it("loads a hosted provider with defaults", () => {
			const c = loadConfig({
				...base,
				AI_PROVIDER: "anthropic",
				AI_MODEL: "claude-x",
				AI_API_KEY: "k",
			});
			expect(c.ai).toEqual({
				provider: "anthropic",
				model: "claude-x",
				apiKey: "k",
				baseUrl: undefined,
				maxSteps: 8,
				temperature: undefined,
			});
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
				apiKey: undefined,
				temperature: 0.7,
				maxSteps: 4,
			});
		});

		it("names a missing model", () => {
			expect(
				errorOf({ ...base, AI_PROVIDER: "openai", AI_API_KEY: "k" }).issues,
			).toEqual(["AI_MODEL is required when AI_PROVIDER is set"]);
		});

		it("names a missing key", () => {
			expect(
				errorOf({ ...base, AI_PROVIDER: "google", AI_MODEL: "m" }).issues,
			).toEqual(["AI_API_KEY is required when AI_PROVIDER is google"]);
		});

		it("names a missing base URL for openai-compatible", () => {
			expect(
				errorOf({ ...base, AI_PROVIDER: "openai-compatible", AI_MODEL: "m" })
					.issues,
			).toEqual([
				"AI_BASE_URL is required when AI_PROVIDER is openai-compatible",
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

		it("never exposes the key in errors or the loggable config", () => {
			const secret = "sk-very-secret-key";
			const err = errorOf({
				...base,
				AI_PROVIDER: "openai",
				AI_API_KEY: secret,
			});
			expect(err.message).not.toContain(secret);
			expect(JSON.stringify(err)).not.toContain(secret);
			expect(String(err.stack)).not.toContain(secret);

			const c = loadConfig({
				...base,
				AI_PROVIDER: "openai",
				AI_MODEL: "m",
				AI_API_KEY: secret,
			});
			const logged = JSON.stringify(redactedConfig(c));
			expect(logged).not.toContain(secret);
			expect(redactedConfig(c).ai?.apiKeySet).toBe(true);
		});
	});
});
