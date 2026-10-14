import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import type { Database } from "#/server/db";
import type { Logger } from "#/server/logger";
import { instanceSettings, sessions } from "./schema";

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export type PasswordCheck =
	| { enabled: false }
	| { enabled: true; verify: (input: string) => Promise<boolean> };

/**
 * Prepares password checking at startup. With no password, the instance is
 * open (and says so). Otherwise loads or creates the salt, derives the scrypt
 * hash, and, if it differs from the stored one (the password changed),
 * deletes every session in the same transaction. Only the derived hash is
 * kept in memory.
 */
export async function setupPassword(
	db: Database,
	password: string | undefined,
	log: Pick<Logger, "info" | "warn">,
): Promise<PasswordCheck> {
	if (!password) {
		log.warn(
			"AUTH_PASSWORD is not set: anyone who can reach this instance can use it. Set it unless the instance is only on a trusted network or behind an authenticating proxy.",
		);
		return { enabled: false };
	}

	await db
		.insert(instanceSettings)
		.values({ key: "password_salt", value: randomBytes(16).toString("hex") })
		.onConflictDoNothing();
	const [saltRow] = await db
		.select()
		.from(instanceSettings)
		.where(eq(instanceSettings.key, "password_salt"));
	const salt = Buffer.from(saltRow?.value ?? "", "hex");
	const expected = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT);
	const expectedHex = expected.toString("hex");

	await db.transaction(async (tx) => {
		const [stored] = await tx
			.select()
			.from(instanceSettings)
			.where(eq(instanceSettings.key, "password_hash"))
			.for("update");
		if (stored?.value === expectedHex) return;
		const removed = await tx.delete(sessions).returning({ id: sessions.id });
		await tx
			.insert(instanceSettings)
			.values({ key: "password_hash", value: expectedHex })
			.onConflictDoUpdate({
				target: instanceSettings.key,
				set: { value: sql`excluded.value` },
			});
		if (stored)
			log.info(
				{ sessionsEnded: removed.length },
				"password changed; all sessions ended",
			);
	});
	log.info("password protection enabled");

	return {
		enabled: true,
		verify: async (input: string) => {
			const actual = await scryptAsync(input, salt, KEY_LENGTH, SCRYPT);
			return timingSafeEqual(actual, expected);
		},
	};
}
