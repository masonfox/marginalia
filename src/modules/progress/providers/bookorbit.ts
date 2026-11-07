// BookOrbit adapter (design D2, lookup mode). BookOrbit serves KOReader's
// kosync protocol under `/api/v1/koreader`, with header auth: `x-auth-user`
// is the KOReader username from BookOrbit's Settings > KOReader, and
// `x-auth-key` is that account's password, plain or as its MD5 hex (BookOrbit
// accepts either; the KOReader plugin sends the MD5).
import type { Edition } from "#/modules/library";
import type {
	ProgressProvider,
	ProgressReading,
	ProviderConfig,
	SpineLocator,
	TestResult,
} from "../types";

const TIMEOUT_MS = 10_000;
const ACCEPT = "application/vnd.koreader.v1+json";

/**
 * The kosync base for an instance URL. Like BookOrbit's own plugin, it accepts
 * the bare instance URL or one that already ends in `/api/v1` or
 * `/api/v1/koreader`.
 */
export function kosyncBase(url: string): string {
	const root = url
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/api\/v1(\/koreader)?$/, "");
	return `${root}/api/v1/koreader`;
}

function request(cfg: ProviderConfig, path: string): Promise<Response> {
	return fetch(`${kosyncBase(cfg.url ?? "")}${path}`, {
		headers: {
			accept: ACCEPT,
			"x-auth-user": cfg.username ?? "",
			"x-auth-key": cfg.key ?? "",
		},
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
}

async function testConnection(cfg: ProviderConfig): Promise<TestResult> {
	let res: Response;
	try {
		res = await request(cfg, "/users/auth");
	} catch (err) {
		return { status: "unreachable", detail: errorDetail(err) };
	}
	if (res.ok) return { status: "ok" };
	if (res.status === 401 || res.status === 403)
		return { status: "rejected", detail: await responseDetail(res) };
	if (res.status === 429)
		return { status: "rate-limited", detail: await responseDetail(res) };
	// A 404 or 5xx means the URL does not lead to a working BookOrbit.
	return { status: "unreachable", detail: `HTTP ${res.status}` };
}

async function get(
	cfg: ProviderConfig,
	digest: string,
): Promise<ProgressReading | null> {
	const res = await request(
		cfg,
		`/syncs/progress/${encodeURIComponent(digest)}`,
	);
	if (res.status === 404) return null;
	if (!res.ok)
		throw new Error(
			`BookOrbit progress lookup failed: HTTP ${res.status} ${await responseDetail(res)}`.trim(),
		);
	return parseProgress(await res.json());
}

/**
 * A kosync progress document as a reading, or null when BookOrbit knows no
 * progress for the book (it answers `{}`).
 */
export function parseProgress(body: unknown): ProgressReading | null {
	if (!body || typeof body !== "object") return null;
	const { percentage, progress, timestamp } = body as Record<string, unknown>;
	const fraction = toNumber(percentage);
	const locator = typeof progress === "string" ? parseXPointer(progress) : null;
	if (fraction === null && !locator) return null;
	const reading: ProgressReading = {
		state: fraction !== null && fraction >= 1 ? "finished" : "reading",
	};
	if (fraction !== null) reading.fraction = Math.min(Math.max(fraction, 0), 1);
	if (locator) reading.locator = locator;
	const seconds = toNumber(timestamp);
	if (seconds !== null && seconds > 0)
		reading.observedAt = new Date(seconds * 1000);
	return reading;
}

/**
 * The spine section of a CREngine xpointer such as
 * `/body/DocFragment[12]/body/div/p[3]/text().42`. DocFragment is 1-based, the
 * spine locator 0-based. The rest of the path is not a passage offset, so it
 * is dropped. A paged document's plain page number gives null.
 */
export function parseXPointer(xpointer: string): SpineLocator | null {
	const match = /^\/body\/DocFragment\[(\d+)\]/.exec(xpointer.trim());
	if (!match) return null;
	const fragment = Number(match[1]);
	if (!Number.isSafeInteger(fragment) || fragment < 1) return null;
	return { kind: "spine", index: fragment - 1 };
}

function toNumber(value: unknown): number | null {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function errorDetail(err: unknown): string {
	if (err instanceof Error) {
		if (err.name === "TimeoutError" || err.name === "AbortError")
			return `No response within ${TIMEOUT_MS / 1000}s`;
		const cause = (err as { cause?: unknown }).cause;
		return cause instanceof Error ? cause.message : err.message;
	}
	return String(err);
}

async function responseDetail(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { message?: unknown };
		if (typeof body.message === "string") return body.message;
	} catch {
		// Not JSON; the status says enough.
	}
	return `HTTP ${res.status}`;
}

export const bookorbit: ProgressProvider = {
	kind: "bookorbit",
	label: "BookOrbit",
	configFields: [
		{
			key: "url",
			label: "Server URL",
			type: "url",
			hint: "Your BookOrbit address, such as https://books.example.com",
			required: true,
		},
		{
			key: "username",
			label: "KOReader username",
			type: "text",
			required: true,
		},
		{
			key: "key",
			label: "KOReader password",
			type: "secret",
			hint: "The password, or its MD5 hash",
			required: true,
		},
	],
	help: "Use the KOReader sync account from BookOrbit's Settings > KOReader, not your BookOrbit login. The account needs the KOReader sync permission, with sync enabled. Books are matched by the KOReader digest of the file, so Marginalia and BookOrbit need the same file.",
	testConnection,
	matching: {
		mode: "lookup",
		keyFor: async (edition: Edition) => edition.koreaderDigest ?? null,
		get,
	},
};
