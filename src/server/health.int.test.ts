import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";
import { POSTGRES_IMAGE } from "../../test/postgres.global-setup";
import { createDb } from "./db";
import { healthResponse, publicOrigin } from "./health";

describe("health endpoint", () => {
	it("is 200 while the database is up and 503 once it stops", async () => {
		const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
		const { db, pool } = createDb(container.getConnectionUri());
		pool.on("error", () => {});
		try {
			const up = await healthResponse(db);
			expect(up.status).toBe(200);
			expect(await up.json()).toEqual({ status: "ok" });
			await container.stop();
			const down = await healthResponse(db, 2000);
			expect(down.status).toBe(503);
		} finally {
			await pool.end().catch(() => {});
		}
	}, 120_000);
});

describe("publicOrigin", () => {
	const behindProxy = new Request("http://app:3000/api/uploads", {
		headers: {
			host: "app:3000",
			"x-forwarded-proto": "https",
			"x-forwarded-host": "books.example.com",
		},
	});

	it("uses forwarded headers to produce https URLs", () => {
		expect(publicOrigin(behindProxy, undefined)).toBe(
			"https://books.example.com",
		);
	});

	it("prefers MARGINALIA_PUBLIC_URL", () => {
		expect(publicOrigin(behindProxy, "https://library.example.org/")).toBe(
			"https://library.example.org",
		);
	});

	it("falls back to the request", () => {
		expect(
			publicOrigin(new Request("http://localhost:3000/x"), undefined),
		).toBe("http://localhost:3000");
	});
});
