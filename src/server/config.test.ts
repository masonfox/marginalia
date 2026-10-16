import { describe, expect, it } from "vitest";
import {
	ConfigError,
	loadConfig,
	redactedConfig,
	runsWorker,
	servesWeb,
} from "./config";

const base = {
	DATABASE_URL: "postgres://u:dbsecret@localhost:5432/m",
	MARGINALIA_SECRET_KEY: Buffer.alloc(32, 7).toString("base64"),
};

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
		const err = errorOf({ MARGINALIA_SECRET_KEY: base.MARGINALIA_SECRET_KEY });
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
			MARGINALIA_SECRET_KEY: base.MARGINALIA_SECRET_KEY,
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

	describe("AI configuration", () => {
		it("ignores removed credentials and model variables without warnings", () => {
			const c = loadConfig({
				...base,
				AI_PROVIDER: "invalid",
				AI_MODEL: "m",
				AI_API_KEY: "secret",
				AI_BASE_URL: "bad",
				AI_PREPROCESS_MODEL: "m",
				AI_OPENAI_API_KEY: "secret",
				AI_OPENAI_BASE_URL: "bad",
				AI_ANTHROPIC_API_KEY: "secret",
				AI_ANTHROPIC_BASE_URL: "bad",
				AI_GOOGLE_API_KEY: "secret",
				AI_GOOGLE_BASE_URL: "bad",
				AI_OPENAI_COMPATIBLE_API_KEY: "secret",
				AI_OPENAI_COMPATIBLE_BASE_URL: "bad",
				AI_PREPROCESS_AUTO: "true",
			});
			expect(c.ai).toEqual({
				maxSteps: 8,
				temperature: undefined,
				effort: undefined,
				promptCache: true,
				prices: {},
			});
			expect(c.preprocessAuto).toBe(true);
			expect(c).not.toHaveProperty("warnings");
		});
		it.each([
			undefined,
			"",
			"c2hvcnQ=",
			"invalid!",
		])("rejects missing, short or malformed secrets", (value) => {
			const error = errorOf({ ...base, MARGINALIA_SECRET_KEY: value });
			expect(error.message).toContain("MARGINALIA_SECRET_KEY");
			expect(error.message).toContain("openssl rand -base64 32");
			if (value) expect(error.message).not.toContain(value);
		});
		it("registers and redacts the secret", async () => {
			const { maskSecrets } = await import("#/modules/ai");
			const c = loadConfig(base);
			expect(JSON.stringify(redactedConfig(c))).not.toContain(
				base.MARGINALIA_SECRET_KEY,
			);
			expect(maskSecrets(base.MARGINALIA_SECRET_KEY)).toBe("[redacted]");
		});
		it.each([
			["AI_MAX_STEPS", "0"],
			["AI_TEMPERATURE", "hot"],
			["AI_EFFORT", "extreme"],
			["AI_PROMPT_CACHE", "sometimes"],
			["AI_PRICES", "invalid"],
			["AI_PREPROCESS_AUTO", "maybe"],
		])("validates %s", (name, value) => {
			expect(
				errorOf({ ...base, [name]: value }).issues.map((i) => i.split(" ")[0]),
			).toEqual([name]);
		});
	});
});
