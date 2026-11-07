import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	getProviderConfig,
	listProviderConfigs,
	loadProviderConfig,
	saveProviderConfig,
} from ".";

let t: TestDb;
const secret = Buffer.alloc(32, 9).toString("base64");
const otherSecret = Buffer.alloc(32, 3).toString("base64");
const token = "hardcover-token-abcd-7731";
const key = "bookorbit-private-key-5521";

beforeAll(async () => {
	t = await createTestDb();
});
beforeEach(async () => {
	await t.pool.query("delete from progress_providers");
});

describe("progress provider config", () => {
	it("never returns secrets in plaintext from the read model or the row", async () => {
		const saved = await saveProviderConfig(t.db, secret, "bookorbit", {
			enabled: true,
			schedule: "6h",
			values: {
				url: "https://orbit.test",
				username: "reader",
				key,
			},
		});
		expect(saved.status).toBe("ok");
		expect(JSON.stringify(saved)).not.toContain(key);

		const view = await getProviderConfig(t.db, secret, "bookorbit");
		expect(view).toMatchObject({
			kind: "bookorbit",
			saved: true,
			enabled: true,
			priority: 1,
			schedule: "6h",
			values: { url: "https://orbit.test", username: "reader" },
			secrets: { key: { set: true, hint: "5521" } },
			configured: true,
			unreadable: false,
			lastSyncAt: null,
		});
		const list = await listProviderConfigs(t.db, secret);
		expect(list.map((p) => p.kind)).toEqual(["bookorbit", "hardcover"]);
		expect(list[1]).toMatchObject({
			saved: false,
			priority: null,
			configured: false,
			secrets: { token: { set: false, hint: null } },
		});
		expect(JSON.stringify(list)).not.toContain(key);

		const rows = await t.pool.query("select * from progress_providers");
		expect(JSON.stringify(rows.rows)).not.toContain(key);
		expect(rows.rows[0].config).toEqual({
			url: "https://orbit.test",
			username: "reader",
		});
	});

	it("round-trips secrets through the server loader", async () => {
		await saveProviderConfig(t.db, secret, "bookorbit", {
			values: { url: "https://orbit.test", username: "reader", key },
		});
		expect(await loadProviderConfig(t.db, secret, "bookorbit")).toEqual({
			status: "ok",
			config: { url: "https://orbit.test", username: "reader", key },
		});
		expect(await loadProviderConfig(t.db, secret, "hardcover")).toEqual({
			status: "missing",
		});
	});

	it("keeps the saved secret when an update leaves it blank or omits it", async () => {
		await saveProviderConfig(t.db, secret, "hardcover", {
			values: { token },
		});
		await saveProviderConfig(t.db, secret, "hardcover", {
			enabled: true,
			values: { token: "  " },
		});
		await saveProviderConfig(t.db, secret, "hardcover", { schedule: "24h" });
		expect(await loadProviderConfig(t.db, secret, "hardcover")).toEqual({
			status: "ok",
			config: { token },
		});
		expect(await getProviderConfig(t.db, secret, "hardcover")).toMatchObject({
			enabled: true,
			schedule: "24h",
		});

		await saveProviderConfig(t.db, secret, "hardcover", {
			values: { token: "replacement-token-0042" },
		});
		expect(await loadProviderConfig(t.db, secret, "hardcover")).toEqual({
			status: "ok",
			config: { token: "replacement-token-0042" },
		});
	});

	it("keeps other secrets and plain fields on a partial update", async () => {
		await saveProviderConfig(t.db, secret, "bookorbit", {
			values: { url: "https://orbit.test", username: "reader", key },
		});
		await saveProviderConfig(t.db, secret, "bookorbit", {
			values: { username: "" },
		});
		expect(await loadProviderConfig(t.db, secret, "bookorbit")).toEqual({
			status: "ok",
			config: { url: "https://orbit.test", key },
		});
		expect(
			(await getProviderConfig(t.db, secret, "bookorbit")).configured,
		).toBe(false);
	});

	it("gives new providers the next free priority", async () => {
		await saveProviderConfig(t.db, secret, "hardcover", { values: { token } });
		await saveProviderConfig(t.db, secret, "bookorbit", {});
		await saveProviderConfig(t.db, secret, "hardcover", { enabled: true });
		const list = await listProviderConfigs(t.db, secret);
		expect(list.map((p) => [p.kind, p.priority])).toEqual([
			["bookorbit", 2],
			["hardcover", 1],
		]);
	});

	it("rejects unknown fields, bad URLs and bad schedules without echoing secrets", async () => {
		expect(
			await saveProviderConfig(t.db, secret, "hardcover", {
				values: { nope: "x" },
			}),
		).toMatchObject({ status: "invalid" });
		expect(
			await saveProviderConfig(t.db, secret, "bookorbit", {
				values: { url: "ftp://orbit.test", key },
			}),
		).toMatchObject({ status: "invalid" });
		expect(
			await saveProviderConfig(t.db, secret, "hardcover", {
				schedule: "2h" as never,
			}),
		).toMatchObject({ status: "invalid" });
		const bad = await saveProviderConfig(t.db, secret, "hardcover", {
			values: { token: `${token}\u0000` },
		});
		expect(bad.status).toBe("invalid");
		expect(JSON.stringify(bad)).not.toContain(token);
		expect(
			await t.pool.query("select 1 from progress_providers"),
		).toMatchObject({ rowCount: 0 });
	});

	it("reports secrets saved under another secret key as unreadable", async () => {
		await saveProviderConfig(t.db, secret, "hardcover", { values: { token } });
		expect(await loadProviderConfig(t.db, otherSecret, "hardcover")).toEqual({
			status: "unreadable",
		});
		expect(
			await getProviderConfig(t.db, otherSecret, "hardcover"),
		).toMatchObject({
			unreadable: true,
			secrets: { token: { set: false, hint: null } },
		});
	});

	it("binds the encrypted blob to its provider", async () => {
		await saveProviderConfig(t.db, secret, "hardcover", { values: { token } });
		await saveProviderConfig(t.db, secret, "bookorbit", {
			values: { url: "https://orbit.test", username: "reader", key },
		});
		// Copy hardcover's blob onto bookorbit: AAD must make it unreadable.
		await t.pool.query(
			`update progress_providers b set secrets_ciphertext = h.secrets_ciphertext,
			   secrets_iv = h.secrets_iv, secrets_tag = h.secrets_tag
			 from progress_providers h where b.kind = 'bookorbit' and h.kind = 'hardcover'`,
		);
		expect(await loadProviderConfig(t.db, secret, "bookorbit")).toEqual({
			status: "unreadable",
		});
	});
});
