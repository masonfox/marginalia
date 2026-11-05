import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useCallback } from "react";
import { ConversationRow } from "#/components/conversation-list";
import { Button } from "#/components/ui/button";
import { listRecentConversationsFn } from "#/fns/conversations";
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
		<main className="mx-auto max-w-5xl px-4 py-8">
			<h1 className="font-serif text-3xl font-semibold">Conversations</h1>
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
				<ul
					className="mt-6 divide-y rounded-md border"
					aria-label="Conversations, most recently active first"
				>
					{conversations.map((c) => (
						<ConversationRow key={c.id} bookLabel="books" conversation={c} />
					))}
				</ul>
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
