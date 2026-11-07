import {
	infiniteQueryOptions,
	keepPreviousData,
	useInfiniteQuery,
	useQueries,
	useQueryClient,
} from "@tanstack/react-query";
import {
	createFileRoute,
	getRouteApi,
	Link,
	useNavigate,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
	AlertTriangle,
	BookOpen,
	LoaderCircle,
	RefreshCw,
	Search,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { BookCover } from "#/components/book-cover";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { listShelfFn, rescanLibrary, retryFailedImport } from "#/fns/library";
import { useSentinel } from "#/hooks/use-sentinel";
import {
	MAX_SHELF_QUERY,
	SHELF_FILTERS,
	SHELF_STATUS_CLASS,
	SHELF_STATUS_LABEL,
	type ShelfFilter,
	shelfCountLabel,
	shelfFilterOptions,
	shouldPollShelf,
} from "#/lib/shelf-status";

interface ShelfSearch {
	q?: string;
	status?: ShelfFilter;
}

/** Typing waits this long before the URL (and the list) follow. */
const SEARCH_DEBOUNCE_MS = 250;

const shelfQuery = ({ q, status }: ShelfSearch) => {
	const search = { q: q?.trim() || undefined, status };
	return infiniteQueryOptions({
		queryKey: ["shelf", search],
		queryFn: ({ pageParam }) =>
			listShelfFn({ data: { ...search, cursor: pageParam } }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
};

/** Invalid values fall back to no search or filter rather than an error page. */
const searchSchema = z.object({
	q: z.string().max(MAX_SHELF_QUERY).optional().catch(undefined),
	status: z.enum(SHELF_FILTERS).optional().catch(undefined),
});

export const Route = createFileRoute("/library")({
	head: () => ({ meta: [{ title: "Library · Marginalia" }] }),
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ q: search.q, status: search.status }),
	loader: ({ context, deps }) =>
		context.queryClient.ensureInfiniteQueryData(shelfQuery(deps)),
	component: LibraryPage,
});

const rootApi = getRouteApi("__root__");

function LibraryPage() {
	const shell = rootApi.useLoaderData();
	const { q, status } = Route.useSearch();
	const navigate = useNavigate({ from: "/library" });
	const setSearch = useCallback(
		(next: ShelfSearch) =>
			navigate({
				search: (prev) => ({ ...prev, ...next }),
				replace: true,
			}),
		[navigate],
	);

	const shelf = useInfiniteQuery({
		...shelfQuery({ q, status }),
		placeholderData: keepPreviousData,
		// Poll while anything in the library is being imported, so statuses,
		// counts, and the filter update without a reload. Rows and counts are
		// separate reads, so a loaded book can show Processing while the count
		// is already 0; keep polling until every visible Processing badge resolves.
		refetchInterval: (query) =>
			shouldPollShelf(query.state.data?.pages) ? 3000 : false,
	});
	const pages = shelf.data?.pages ?? [];
	const first = pages[0];
	const items = pages.flatMap((p) => p.items);
	const total = first?.total ?? 0;
	const counts = useQueries({
		queries: SHELF_FILTERS.filter((value) => value !== "attention").map(
			(value) => ({
				queryKey: ["shelf", "count", value],
				queryFn: () => listShelfFn({ data: { status: value } }),
				refetchInterval: (first?.processing ?? 0) > 0 ? 3000 : false,
			}),
		),
	});
	const filterCounts: Partial<Record<ShelfFilter | "all", number>> = {
		all: total,
		attention: first?.needsAttention ?? 0,
	};
	for (const [i, value] of (
		["not-started", "reading", "finished"] as const
	).entries()) {
		const count = counts[i]?.data?.matching;
		if (count != null) filterCounts[value] = count;
	}
	const matching = first?.matching ?? 0;
	const narrowed = Boolean(q?.trim()) || status !== undefined;
	const setQuery = useCallback(
		(text: string) => setSearch({ q: text || undefined }),
		[setSearch],
	);

	const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } =
		shelf;
	const loadMore = useCallback(() => {
		void fetchNextPage();
	}, [fetchNextPage]);
	// isFetching also covers background refetches; a refetch finishing re-arms the sentinel.
	// After a failed next page, stop auto-loading until the reader asks to try again.
	const sentinel = useSentinel(
		loadMore,
		hasNextPage && !isFetching && !isFetchNextPageError,
	);

	return (
		<main className="mx-auto max-w-[1240px] px-4 pt-8 pb-24 sm:px-8 sm:pt-14">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="font-serif text-[clamp(48px,5vw,68px)] leading-[1.02] font-semibold tracking-[-0.015em]">
						Library
					</h1>
					<p
						className="mt-2 text-sm text-muted-foreground"
						data-testid="library-count"
					>
						{shelfCountLabel(total, matching, narrowed)}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{shell.hasLibraryPaths && <RescanButton />}
					<UploadControl maxUploadMb={shell.maxUploadMb} />
				</div>
			</div>

			{total === 0 ? (
				<div className="mt-12 rounded-lg border border-dashed p-10 text-center">
					<BookOpen
						className="mx-auto size-8 text-muted-foreground"
						aria-hidden
					/>
					<h2 className="mt-3 font-medium">No books yet</h2>
					<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
						Upload an EPUB with the button above, or mount a folder of EPUBs and
						list it in <code className="text-xs">MARGINALIA_LIBRARY_PATHS</code>{" "}
						so it is scanned automatically.
					</p>
				</div>
			) : (
				<>
					<div className="mt-9 flex min-w-0 flex-wrap items-center gap-3.5">
						<SearchBox value={q ?? ""} onChange={setQuery} />
						<StatusFilter
							selected={status}
							counts={filterCounts}
							needsAttention={first?.needsAttention ?? 0}
							onChange={(next) => setSearch({ status: next })}
						/>
					</div>

					{matching === 0 && first ? (
						<div className="mt-12 rounded-lg border border-dashed p-10 text-center">
							<Search
								className="mx-auto size-8 text-muted-foreground"
								aria-hidden
							/>
							<h2 className="mt-3 font-medium">No books match</h2>
							<Button
								className="mt-4"
								variant="outline"
								onClick={() => setSearch({ q: undefined, status: undefined })}
							>
								Clear search and filter
							</Button>
						</div>
					) : (
						<ul
							className="mt-10 grid grid-cols-2 gap-x-5 gap-y-11 sm:grid-cols-3 sm:gap-x-7 md:grid-cols-4 lg:grid-cols-6"
							data-testid="library-books"
						>
							{items.map((e) => (
								<li
									key={e.id}
									className="flex min-w-0 flex-col"
									aria-busy={e.status === "processing"}
								>
									<Link
										to="/books/$editionId"
										params={{ editionId: e.id }}
										className="group block"
									>
										{e.status === "processing" ? (
											<div className="flex aspect-[2/3] items-end rounded-[3px_7px_7px_3px] border bg-secondary p-4">
												<LoaderCircle
													aria-hidden
													className="size-5 animate-spin text-status-processing motion-reduce:animate-none"
												/>
											</div>
										) : e.status === "failed" || e.status === "unavailable" ? (
											<div className="flex aspect-[2/3] items-center justify-center rounded-[3px_7px_7px_3px] border border-dashed border-status-failed/55 bg-status-failed/5">
												<AlertTriangle
													aria-hidden
													className="size-6 text-status-failed"
												/>
											</div>
										) : (
											<BookCover
												id={e.id}
												title={e.title}
												hasCover={e.hasCover}
												author={e.authors[0]}
											/>
										)}
										<h2 className="mt-3.5 line-clamp-2 text-[15px] leading-snug font-semibold break-words group-hover:underline">
											{e.title}
										</h2>
									</Link>
									{e.authors.length > 0 && (
										<p className="line-clamp-1 text-sm break-words text-muted-foreground">
											{e.authors.join(", ")}
										</p>
									)}
									<div className="mt-2.5">
										<Badge
											variant="status"
											className={SHELF_STATUS_CLASS[e.status]}
										>
											{SHELF_STATUS_LABEL[e.status]}
										</Badge>
									</div>
									{e.status === "failed" && (
										<FailedImport id={e.id} error={e.error} />
									)}
								</li>
							))}
						</ul>
					)}
					<div ref={sentinel} aria-hidden className="h-px" />
					{shelf.isFetchingNextPage && (
						<output className="mt-6 block text-center text-sm text-muted-foreground">
							Loading more…
						</output>
					)}
					{isFetchNextPageError && !isFetching && (
						<output className="mt-6 block text-center text-sm text-muted-foreground">
							Couldn't load more books.{" "}
							<Button size="sm" variant="outline" onClick={loadMore}>
								Try again
							</Button>
						</output>
					)}
				</>
			)}
		</main>
	);
}

function SearchBox({
	value,
	onChange,
}: {
	value: string;
	onChange: (text: string) => void;
}) {
	const [text, setText] = useState(value);
	const pushed = useRef(value);
	// Follow URL changes made elsewhere (clearing, back and forward), not our own echo.
	useEffect(() => {
		if (value !== pushed.current) {
			pushed.current = value;
			setText(value);
		}
	}, [value]);
	useEffect(() => {
		if (text === pushed.current) return;
		const timer = setTimeout(() => {
			pushed.current = text;
			onChange(text);
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [text, onChange]);

	return (
		<div className="relative w-full sm:max-w-[380px] sm:flex-[1_1_280px]">
			<Search
				aria-hidden
				className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="search"
				aria-label="Search by title or author"
				placeholder="Search by title or author"
				maxLength={MAX_SHELF_QUERY}
				className="pl-8"
				value={text}
				onChange={(e) => setText(e.target.value)}
			/>
		</div>
	);
}

function StatusFilter({
	selected,
	counts,
	needsAttention,
	onChange,
}: {
	selected: ShelfFilter | undefined;
	counts: Partial<Record<ShelfFilter | "all", number>>;
	needsAttention: number;
	onChange: (status: ShelfFilter | undefined) => void;
}) {
	// One row that scrolls sideways when the filters do not fit (phones).
	return (
		<fieldset
			className="flex min-w-0 max-w-full gap-1.5 overflow-x-auto pb-1"
			aria-label="Filter by status"
			data-testid="status-filter"
		>
			{shelfFilterOptions(needsAttention, selected).map((option) => (
				<Button
					key={option.label}
					size="sm"
					variant={option.value === selected ? "secondary" : "ghost"}
					className="min-h-11 shrink-0 rounded-full border border-input px-3.5 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
					aria-pressed={option.value === selected}
					onClick={() => onChange(option.value)}
				>
					{option.label}{" "}
					{counts[option.value ?? "all"] !== undefined && (
						<span className="ml-1 font-semibold">
							{counts[option.value ?? "all"]}
						</span>
					)}
				</Button>
			))}
		</fieldset>
	);
}

/**
 * After an upload or retry: the list, the dashboard's Reading shelf, and
 * anything else showing editions.
 */
function invalidateLibrary(queryClient: ReturnType<typeof useQueryClient>) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: ["editions"] }),
		queryClient.invalidateQueries({ queryKey: ["shelf"] }),
		queryClient.invalidateQueries({ queryKey: ["reading-shelf"] }),
	]);
}

function FailedImport({ id, error }: { id: string; error: string | null }) {
	const queryClient = useQueryClient();
	const retry = useServerFn(retryFailedImport);
	const [busy, setBusy] = useState(false);
	return (
		<div className="mt-2 space-y-1">
			{error && (
				<p className="text-sm break-words text-destructive-foreground">
					{error}
				</p>
			)}
			<Button
				size="sm"
				variant="outline"
				disabled={busy}
				onClick={async () => {
					setBusy(true);
					try {
						await retry({ data: { editionId: id } });
						await invalidateLibrary(queryClient);
					} finally {
						setBusy(false);
					}
				}}
			>
				Retry
			</Button>
		</div>
	);
}

function RescanButton() {
	const rescan = useServerFn(rescanLibrary);
	const [message, setMessage] = useState<string | null>(null);
	return (
		<div className="flex items-center gap-2">
			{message && (
				<span className="text-sm text-muted-foreground">{message}</span>
			)}
			<Button
				variant="outline"
				onClick={async () => {
					const { enqueued } = await rescan({ data: { full: false } });
					setMessage(enqueued ? "Rescan started" : "A scan is already running");
				}}
			>
				<RefreshCw aria-hidden /> Rescan library
			</Button>
		</div>
	);
}

function UploadControl({ maxUploadMb }: { maxUploadMb: number }) {
	const queryClient = useQueryClient();
	const input = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const upload = async (file: File) => {
		setError(null);
		if (file.size > maxUploadMb * 1024 * 1024) {
			setError(`The file is larger than the ${maxUploadMb} MB upload limit.`);
			return;
		}
		setBusy(true);
		try {
			const body = new FormData();
			body.set("file", file, file.name);
			const res = await fetch("/api/uploads", { method: "POST", body });
			if (!res.ok) {
				const payload = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				setError(payload?.error ?? `Upload failed (${res.status}).`);
				return;
			}
			await invalidateLibrary(queryClient);
		} catch {
			setError("Upload failed. Check your connection and try again.");
		} finally {
			setBusy(false);
			if (input.current) input.current.value = "";
		}
	};

	return (
		<div className="flex flex-col items-end gap-1">
			<input
				ref={input}
				type="file"
				accept=".epub,application/epub+zip"
				className="sr-only"
				id="upload"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) void upload(file);
				}}
			/>
			<Button disabled={busy} onClick={() => input.current?.click()}>
				<Upload aria-hidden /> {busy ? "Uploading…" : "Upload EPUB"}
			</Button>
			{error && (
				<p
					role="alert"
					className="max-w-xs text-right text-sm text-destructive-foreground"
				>
					{error}
				</p>
			)}
		</div>
	);
}
