import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
	testDir: "e2e",
	testMatch: "conversation-prompt.spec.ts",
	workers: 1,
	fullyParallel: false,
	timeout: 120_000,
	use: { trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
