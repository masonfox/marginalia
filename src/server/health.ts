import { sql } from "drizzle-orm";
import type { Executor } from "./db";

/** 200 when `SELECT 1` succeeds within the timeout, 503 otherwise. */
export async function healthResponse(
	db: Executor,
	timeoutMs = 3000,
): Promise<Response> {
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			db.execute(sql`select 1`),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
			}),
		]);
		return Response.json(
			{ status: "ok" },
			{ headers: { "cache-control": "no-store" } },
		);
	} catch {
		return Response.json(
			{ status: "unavailable", reason: "database unreachable" },
			{ status: 503, headers: { "cache-control": "no-store" } },
		);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The origin clients use to reach the instance, for the rare absolute URL:
 * MARGINALIA_PUBLIC_URL when set, otherwise `X-Forwarded-Proto`/`X-Forwarded-Host`,
 * otherwise the request itself. Prefer relative URLs everywhere else.
 */
export function publicOrigin(
	request: Request,
	publicUrl: string | undefined,
): string {
	if (publicUrl) return new URL(publicUrl).origin;
	const url = new URL(request.url);
	const first = (name: string) =>
		request.headers.get(name)?.split(",")[0]?.trim();
	const proto = first("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
	const host =
		first("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
	return `${proto === "https" ? "https" : "http"}://${host}`;
}
