import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		/** Superuser connection string for the shared test server. */
		postgresAdminUrl: string;
	}
}

export const POSTGRES_IMAGE = "pgvector/pgvector:pg17";

/**
 * Starts one PostgreSQL container for the integration run. Set
 * TEST_POSTGRES_URL to reuse an existing server instead (it must allow
 * CREATE DATABASE).
 */
export default async function setup(project: TestProject) {
	const external = process.env.TEST_POSTGRES_URL;
	if (external) {
		project.provide("postgresAdminUrl", external);
		return;
	}
	const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
	project.provide("postgresAdminUrl", container.getConnectionUri());
	return async () => {
		await container.stop();
	};
}
