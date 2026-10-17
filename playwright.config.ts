import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end checks against a running instance:
 *   E2E_BASE_URL (default http://localhost:3000), E2E_PASSWORD (the instance's
 *   AUTH_PASSWORD), E2E_DATABASE_URL (to look up locators), and
 *   E2E_MAX_UPLOAD_MB (the instance's MARGINALIA_MAX_UPLOAD_MB).
 * The running app must have MARGINALIA_SECRET_KEY set (base64, >= 32 bytes).
 * The library must already contain the Standard Ebooks fixture.
 */
export default defineConfig({
	testDir: "e2e",
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
