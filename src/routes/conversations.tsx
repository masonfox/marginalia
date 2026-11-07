import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useCallback, useState } from "react";
import { ConversationRow } from "#/components/conversation-list";
import { Eyebrow } from "#/components/pieces";
import { Button } from "#/components/ui/button";
import { listRecentConversationsFn } from "#/fns/conversations";
import { useHydrated } from "#/hooks/use-hydrated";
import { useSentinel } from "#/hooks/use-sentinel";
import { uniqueById } from "#/lib/conversation-pages";

/** Every conversation, most recently active first, a page at a time. */
const allConversationsQuery = infiniteQueryOptions({
	queryKey: ["conversations", "recent", "all"],
	queryFn: ({ pageParam }) =>
		listRecentConversationsFn({ data: { cursor: pageParam } }),
	initialPageParam: undefined as string | undefined,
	getNextPageParam: (page) => page.nextCursor ?? undefined,
});

export const Route = createFileRoute("/conversations")({
	loader: ({ context }) =>
		context.queryClient.prefetchInfiniteQuery(allConversationsQuery),
	head: () => ({ meta: [{ title: "Conversations · Marginalia" }] }),
	component: ConversationsPage,
});

function ConversationsPage() {
	const list = useInfiniteQuery(allConversationsQuery);
	const conversations = uniqueById(list.data?.pages ?? []);
	const [bookFilter, setBookFilter] = useState<string | null>(null);
	const books = [
		...new Map(
			conversations
				.flatMap((c) => c.books)
				.map((book) => [book.editionId, book]),
		).values(),
	];
	const visible = conversations.filter(
		(c) => !bookFilter || c.books.some((b) => b.editionId === bookFilter),
	);
	// The server and the hydrating client group in UTC so their labels match; local time follows hydration.
	const hydrated = useHydrated();
	const groups = groupConversationsByDate(visible, undefined, {
		utc: !hydrated,
	});
	const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = list;
	const loadMore = useCallback(() => {
		void fetchNextPage();
	}, [fetchNextPage]);
	// As on the library: a refetch finishing re-arms the sentinel, and a failed page waits for Try again.
	const sentinel = useSentinel(
		loadMore,
		hasNextPage && !isFetching && !isFetchNextPageError,
	);

	return (
		<main className="mx-auto max-w-[1040px] px-4 pt-8 pb-24 sm:px-8 sm:pt-14">
			<h1 className="font-serif text-[clamp(48px,5vw,68px)] leading-[1.02] font-semibold tracking-[-0.015em]">
				Conversations
			</h1>
			{conversations.length > 0 && (
				<fieldset
					aria-label="Filter by book"
					className="mt-8 flex flex-wrap gap-2"
				>
					<Button
						variant="outline"
						className="min-h-11 rounded-full aria-pressed:bg-secondary"
						aria-pressed={bookFilter === null}
						onClick={() => setBookFilter(null)}
					>
						All books
					</Button>
					{books.map((book) => (
						<Button
							key={book.editionId}
							variant="outline"
							className="h-auto min-h-11 max-w-full rounded-full py-2 text-left whitespace-normal aria-pressed:bg-secondary"
							aria-pressed={bookFilter === book.editionId}
							onClick={() => setBookFilter(book.editionId)}
						>
							{book.title}
						</Button>
					))}
				</fieldset>
			)}
			{list.isError && !list.data ? (
				<p role="alert" className="mt-6 text-sm text-destructive-foreground">
					Couldn't load conversations.{" "}
					<Button size="sm" variant="outline" onClick={() => list.refetch()}>
						Try again
					</Button>
				</p>
			) : list.data && conversations.length === 0 ? (
				<div
					className="mt-12 rounded-lg border border-dashed p-10 text-center"
					data-testid="conversations-empty"
				>
					<MessagesSquare
						className="mx-auto size-8 text-muted-foreground"
						aria-hidden
					/>
					<h2 className="mt-3 font-medium">No conversations yet</h2>
					<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
						Conversations are started from a book: open one in the library and
						start a conversation on its Discuss tab.
					</p>
				</div>
			) : (
				<div>
					{groups.map((group) => (
						<section
							key={group.label}
							aria-label={group.label}
							className="mt-9"
						>
							<Eyebrow className="mb-1">{group.label}</Eyebrow>
							<ul className="divide-y border-b">
								{group.items.map((c) => (
									<ConversationRow
										key={c.id}
										bookLabel="books"
										conversation={c}
										metaColumn
									/>
								))}
							</ul>
						</section>
					))}
				</div>
			)}
			<div ref={sentinel} aria-hidden className="h-px" />
			{list.isFetchingNextPage && (
				<output className="mt-6 block text-center text-sm text-muted-foreground">
					Loading more…
				</output>
			)}
			{isFetchNextPageError && !isFetching && (
				<output className="mt-6 block text-center text-sm text-muted-foreground">
					Couldn't load more conversations.{" "}
					<Button size="sm" variant="outline" onClick={loadMore}>
						Try again
					</Button>
				</output>
			)}
		</main>
	);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar groups preserve the server's most-recent-first order. With `utc`, day boundaries and month labels use UTC. */
export function groupConversationsByDate<
	T extends { updatedAt: Date | string },
>(items: T[], now = new Date(), { utc = false }: { utc?: boolean } = {}) {
	let today: Date;
	let yesterday: Date;
	let week: Date;
	if (utc) {
		today = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
		);
		yesterday = new Date(today.getTime() - DAY_MS);
		week = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
	} else {
		today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);
		week = new Date(today);
		week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
	}
	const year = (d: Date) => (utc ? d.getUTCFullYear() : d.getFullYear());
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const date = new Date(item.updatedAt);
		const label =
			date >= today
				? "Today"
				: date >= yesterday
					? "Yesterday"
					: date >= week
						? "This week"
						: date.toLocaleDateString("en", {
								month: "long",
								...(year(date) !== year(now)
									? { year: "numeric" as const }
									: {}),
								...(utc ? { timeZone: "UTC" } : {}),
							});
		const group = groups.get(label) ?? [];
		group.push(item);
		groups.set(label, group);
	}
	return [...groups].map(([label, items]) => ({ label, items }));
}
