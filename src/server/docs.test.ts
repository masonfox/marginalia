import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "./config";

/** Variables read outside the config schema, plus those consumed by the runtime itself. */
function variablesReadInSource(dir = "src"): Set<string> {
	const found = new Set<string>();
	for (const name of readdirSync(dir)) {
		const file = path.join(dir, name);
		if (statSync(file).isDirectory()) {
			for (const v of variablesReadInSource(file)) found.add(v);
		} else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
			for (const m of readFileSync(file, "utf8").matchAll(
				/process\.env\.([A-Z][A-Z0-9_]*)/g,
			)) {
				found.add(m[1] as string);
			}
		}
	}
	return found;
}

describe("deployment documentation", () => {
	const docs = readFileSync("docs/deployment.md", "utf8");
	const variables = [
		...Object.keys(envSchema.shape),
		...variablesReadInSource(),
		"HOST", // read by the Nitro server
	];

	it("documents encrypted Settings credentials and removes credential env examples", () => {
		const example = readFileSync(".env.example", "utf8"),
			compose = readFileSync("compose.yaml", "utf8");
		expect(example).toContain("MARGINALIA_SECRET_KEY=");
		expect(compose).toContain(
			"MARGINALIA_SECRET_KEY: ${MARGINALIA_SECRET_KEY:?",
		);
		for (const removed of [
			"AI_PROVIDER",
			"AI_MODEL",
			"AI_API_KEY",
			"AI_BASE_URL",
			"AI_PREPROCESS_MODEL",
			"AI_OPENAI_API_KEY",
			"AI_ANTHROPIC_API_KEY",
			"AI_GOOGLE_API_KEY",
			"AI_OPENAI_COMPATIBLE_BASE_URL",
		]) {
			expect(example).not.toContain(`${removed}=`);
			expect(compose).not.toContain(`${removed}:`);
		}
		expect(docs).toContain("encrypted API keys");
		expect(docs).toContain(
			"anyone who can reach the instance can add, replace, or remove provider keys",
		);
	});
	it.each([...new Set(variables)])("documents %s", (name) => {
		expect(docs).toContain(`\`${name}\``);
	});
});
