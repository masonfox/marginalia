import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
	testDir: "e2e",
	testMatch: "titles.spec.ts",
	workers: 1,
	fullyParallel: false,
	timeout: 60_000,
	use: { trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
