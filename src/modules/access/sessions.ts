import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Executor } from "#/server/db";
import { sessions } from "./schema";

export const SESSION_COOKIE = "marginalia_session";
/** `last_seen_at` is refreshed at most this often, keeping writes negligible. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const hashToken = (token: string) =>
	createHash("sha256").update(token).digest();

export interface Session {
	id: number;
	expiresAt: Date;
}

/** Creates a session; returns the cookie token (only its SHA-256 is stored). */
export async function createSession(
	db: Executor,
	lifetimeDays: number,
	now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString("base64url");
	const expiresAt = new Date(
		now.getTime() + lifetimeDays * 24 * 60 * 60 * 1000,
	);
	await db.insert(sessions).values({
		tokenHash: hashToken(token),
		createdAt: now,
		lastSeenAt: now,
		expiresAt,
	});
	return { token, expiresAt };
}

/** The session for a cookie token, if it exists and has not expired. */
export async function validateSession(
	db: Executor,
	token: string | undefined,
	now = new Date(),
): Promise<Session | null> {
	if (!token || token.length > 100) return null;
	const [row] = await db
		.select()
		.from(sessions)
		.where(
			and(
				eq(sessions.tokenHash, hashToken(token)),
				gt(sessions.expiresAt, now),
			),
		);
	if (!row) return null;
	if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
		await db
			.update(sessions)
			.set({ lastSeenAt: now })
			.where(eq(sessions.id, row.id));
	}
	return { id: row.id, expiresAt: row.expiresAt };
}

export async function deleteSession(db: Executor, token: string | undefined) {
	if (!token) return;
	await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Deletes expired sessions (daily job). */
export async function purgeExpiredSessions(db: Executor, now = new Date()) {
	const removed = await db
		.delete(sessions)
		.where(lt(sessions.expiresAt, now))
		.returning({ id: sessions.id });
	return removed.length;
}

export interface CookieOptions {
	secure: boolean;
	maxAgeSeconds: number;
}

export function sessionCookie(
	token: string,
	{ secure, maxAgeSeconds }: CookieOptions,
): string {
	return [
		`${SESSION_COOKIE}=${token}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAgeSeconds}`,
		...(secure ? ["Secure"] : []),
	].join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
	return sessionCookie("", { secure, maxAgeSeconds: 0 });
}

export function readCookie(request: Request, name: string): string | undefined {
	const header = request.headers.get("cookie");
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const at = part.indexOf("=");
		if (at < 0) continue;
		if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
	}
	return undefined;
}
