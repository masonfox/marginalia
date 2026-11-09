// Hardcover progress provider (design D2 list mode, D7 throttling). One sync
// pages through the reader's user_books with their latest read; the core
// matches the books to editions by ISBN or Hardcover id.
import { ProviderError, RateLimitedError } from "../errors";
import type {
	ProgressProvider,
	ProgressReading,
	ProviderBook,
	ProviderConfig,
	ReadingState,
	TestResult,
} from "../types";

export const HARDCOVER_ENDPOINT = "https://api.hardcover.app/v1/graphql";

/** Hardcover allows 60 requests a minute; stay well under it. */
const DEFAULT_MIN_INTERVAL_MS = 1_200;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 120_000;

/** Hardcover's user_book status ids, as its user_book_statuses table lists them. */
const STATUS: Record<number, ReadingState | null> = {
	1: "not-started", // Want to Read
	2: "reading", // Currently Reading
	3: "finished", // Read
	4: "reading", // Paused: still mid-book
	5: "abandoned", // Did Not Finish
	6: null, // Ignored: not part of the reader's library
};

export const ME_QUERY = `query MarginaliaMe {
  me { id username }
}`;

export const USER_BOOKS_QUERY = `query MarginaliaUserBooks($limit: Int!, $offset: Int!) {
  me {
    user_books(limit: $limit, offset: $offset, order_by: { id: asc }) {
      id
      status_id
      updated_at
      book {
        id
        title
        pages
        contributions { contribution author { name } }
      }
      edition { id isbn_10 isbn_13 pages }
      user_book_reads(order_by: { id: desc }, limit: 1) {
        id
        progress
        progress_pages
        edition { id isbn_10 isbn_13 pages }
      }
    }
  }
}`;

interface HcEdition {
	id: number;
	isbn_10: string | null;
	isbn_13: string | null;
	pages: number | null;
}

export interface HcUserBook {
	id: number;
	status_id: number;
	updated_at?: string | null;
	book: {
		id: number;
		title: string | null;
		pages?: number | null;
		contributions?: {
			contribution: string | null;
			author: { name: string | null } | null;
		}[];
	};
	edition: HcEdition | null;
	user_book_reads?: {
		id: number;
		progress: number | null;
		progress_pages: number | null;
		edition: HcEdition | null;
	}[];
}

interface GraphQLResponse<T> {
	data?: T;
	errors?: { message?: string; extensions?: { code?: string } }[];
}

export interface HardcoverDeps {
	fetch?: typeof fetch;
	/** Milliseconds; injectable for tests. */
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	minIntervalMs?: number;
	maxRetries?: number;
	pageSize?: number;
}

/** Accepts a token pasted with or without its "Bearer " prefix. */
export function normalizeToken(raw: string | undefined): string {
	return (raw ?? "")
		.trim()
		.replace(/^bearer\s+/i, "")
		.trim();
}

/**
 * Spaces requests at least `intervalMs` apart: a token bucket of one, so no
 * burst can push a minute over the limit.
 */
class Throttle {
	private nextAt = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly intervalMs: number,
		private readonly now: () => number,
		private readonly sleep: (ms: number) => Promise<void>,
	) {}

	async take(): Promise<void> {
		const at = Math.max(this.now(), this.nextAt);
		this.nextAt = at + this.intervalMs;
		const wait = at - this.now();
		if (wait > 0) await this.sleep(wait);
	}

	/** After a 429, no request before `ms` from now. */
	pause(ms: number): void {
		this.nextAt = Math.max(this.nextAt, this.now() + ms);
	}
}

/** Retry-After as seconds or an HTTP date, in milliseconds from now. */
export function parseRetryAfter(
	value: string | null,
	now: number,
): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value.trim());
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(value);
	if (Number.isNaN(date)) return undefined;
	return Math.max(0, date - now);
}

function isAuthError(
	errors: NonNullable<GraphQLResponse<unknown>["errors"]>,
): boolean {
	return errors.some((e) => {
		const code = e.extensions?.code ?? "";
		const message = e.message ?? "";
		return (
			/jwt|access-denied|unauthori[sz]ed/i.test(code) ||
			/jwt|token|unauthori[sz]ed|authenticat/i.test(message)
		);
	});
}

export function createHardcoverProvider(
	deps: HardcoverDeps = {},
): ProgressProvider {
	const doFetch = deps.fetch ?? ((...args) => fetch(...args));
	const now = deps.now ?? Date.now;
	const sleep =
		deps.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
	const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
	const throttle = new Throttle(
		deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
		now,
		sleep,
	);

	async function request<T>(
		cfg: ProviderConfig,
		query: string,
		variables: Record<string, unknown>,
		retries: number,
	): Promise<T> {
		const token = normalizeToken(cfg.token);
		if (!token) throw new ProviderError("rejected", "No Hardcover API token");

		for (let attempt = 0; ; attempt++) {
			await throttle.take();
			let res: Response;
			try {
				res = await doFetch(HARDCOVER_ENDPOINT, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ query, variables }),
				});
			} catch (cause) {
				throw new ProviderError(
					"unreachable",
					"Hardcover could not be reached",
					{
						cause,
					},
				);
			}

			if (res.status === 429) {
				const retryAfter = parseRetryAfter(
					res.headers.get("retry-after"),
					now(),
				);
				if (attempt >= retries) {
					throw new RateLimitedError(
						"Hardcover is rate limiting requests",
						retryAfter,
					);
				}
				const wait = Math.min(
					retryAfter ?? DEFAULT_BACKOFF_MS * 2 ** attempt,
					MAX_BACKOFF_MS,
				);
				throttle.pause(wait);
				continue;
			}
			if (res.status === 401 || res.status === 403) {
				throw new ProviderError("rejected", "Hardcover rejected the API token");
			}
			if (!res.ok) {
				throw new ProviderError(
					res.status >= 500 ? "unreachable" : "invalid-response",
					`Hardcover answered HTTP ${res.status}`,
				);
			}

			let body: GraphQLResponse<T>;
			try {
				body = (await res.json()) as GraphQLResponse<T>;
			} catch (cause) {
				throw new ProviderError(
					"invalid-response",
					"Hardcover sent a response that is not JSON",
					{ cause },
				);
			}
			if (body.errors?.length) {
				if (isAuthError(body.errors)) {
					throw new ProviderError(
						"rejected",
						"Hardcover rejected the API token",
					);
				}
				throw new ProviderError(
					"invalid-response",
					`Hardcover error: ${body.errors[0]?.message ?? "unknown"}`,
				);
			}
			if (!body.data) {
				throw new ProviderError("invalid-response", "Hardcover sent no data");
			}
			return body.data;
		}
	}

	async function testConnection(cfg: ProviderConfig): Promise<TestResult> {
		try {
			const data = await request<{ me: { id: number; username: string }[] }>(
				cfg,
				ME_QUERY,
				{},
				0,
			);
			const me = data.me?.[0];
			if (!me)
				return {
					status: "rejected",
					detail: "No Hardcover user for this token",
				};
			return { status: "ok", detail: `Signed in as @${me.username}` };
		} catch (err) {
			if (err instanceof ProviderError) {
				if (err.reason === "invalid-response")
					return { status: "unreachable", detail: err.message };
				return { status: err.reason, detail: err.message };
			}
			throw err;
		}
	}

	async function list(cfg: ProviderConfig): Promise<ProviderBook[]> {
		const books: ProviderBook[] = [];
		for (let offset = 0; ; offset += pageSize) {
			const data = await request<{ me: { user_books: HcUserBook[] }[] }>(
				cfg,
				USER_BOOKS_QUERY,
				{ limit: pageSize, offset },
				maxRetries,
			);
			const me = data.me?.[0];
			if (!me)
				throw new ProviderError("rejected", "No Hardcover user for this token");
			for (const userBook of me.user_books) {
				const book = toProviderBook(userBook);
				if (book) books.push(book);
			}
			if (me.user_books.length < pageSize) return books;
		}
	}

	return {
		kind: "hardcover",
		label: "Hardcover",
		configFields: [
			{
				key: "token",
				label: "API token",
				type: "secret",
				hint: "From Hardcover's account settings, under API (hardcover.app/account/api). With or without “Bearer ” works.",
				required: true,
			},
		],
		help: "Marginalia only reads your Hardcover library and reading progress.",
		testConnection,
		matching: { mode: "list", list },
	};
}

/** Maps one user_book to a provider book, or null for statuses that aren't reading. */
export function toProviderBook(userBook: HcUserBook): ProviderBook | null {
	const state = STATUS[userBook.status_id];
	if (!state) return null;

	const read = userBook.user_book_reads?.[0];
	const reading: ProgressReading = { state };
	if (state === "reading" && read) {
		// progress is a percentage (0-100, capped at 100) of the read's edition;
		// progress_pages can exceed that edition's page count.
		if (read.progress != null && Number.isFinite(read.progress)) {
			reading.fraction = Math.min(1, Math.max(0, read.progress / 100));
		}
		const total =
			read.edition?.pages ?? userBook.edition?.pages ?? userBook.book.pages;
		if (read.progress_pages != null && total && total > 0) {
			reading.pages = { current: read.progress_pages, total };
		}
	}
	if (userBook.updated_at) {
		const at = new Date(userBook.updated_at);
		if (!Number.isNaN(at.getTime())) reading.observedAt = at;
	}

	const isbns = new Set<string>();
	for (const edition of [read?.edition, userBook.edition]) {
		for (const isbn of [edition?.isbn_13, edition?.isbn_10]) {
			const trimmed = isbn?.trim();
			if (trimmed) isbns.add(trimmed);
		}
	}

	const authors = (userBook.book.contributions ?? [])
		.filter((c) => !c.contribution || /^author$/i.test(c.contribution))
		.map((c) => c.author?.name?.trim())
		.filter((name): name is string => !!name);

	const bookId = String(userBook.book.id);
	return {
		externalId: bookId,
		isbns: [...isbns],
		ids: { "hardcover-id": bookId },
		title: userBook.book.title ?? "",
		...(authors.length ? { authors } : {}),
		reading,
	};
}

export const hardcover = createHardcoverProvider();
