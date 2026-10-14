import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					exclude: ["src/**/*.int.test.ts"],
					environment: "node",
				},
			},
			{
				extends: true,
				test: {
					name: "integration",
					include: ["src/**/*.int.test.ts"],
					environment: "node",
					globalSetup: ["test/postgres.global-setup.ts"],
					testTimeout: 60_000,
					hookTimeout: 120_000,
					// Test files share one PostgreSQL container; each file gets its own database.
					fileParallelism: true,
				},
			},
		],
	},
});
