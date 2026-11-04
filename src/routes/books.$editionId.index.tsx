import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { useBook } from "#/components/book-page";
import { DiscussView } from "#/components/discuss";
import { getAiStatusFn, listConversationsFn } from "#/fns/conversations";

export const Route = createFileRoute("/books/$editionId/")({
	// Only to forward search links saved before search moved to Contents.
	validateSearch: z.object({ q: z.string().optional() }),
	beforeLoad: ({ search, params }) => {
		if (search.q !== undefined) {
			throw redirect({
				to: "/books/$editionId/contents",
				params,
				search: { q: search.q },
				replace: true,
			});
		}
	},
	// Runs alongside the layout's loader, which reports a missing book.
	loader: async ({ params }) => {
		if (!z.uuid().safeParse(params.editionId).success) throw notFound();
		const [conversations, status] = await Promise.all([
			listConversationsFn({ data: { editionId: params.editionId } }),
			getAiStatusFn(),
		]);
		return { conversations, status };
	},
	component: DiscussTab,
});

/** Discuss: the composer for a new conversation, then the book's conversations. */
function DiscussTab() {
	const { edition, isReady } = useBook();
	const { conversations, status } = Route.useLoaderData();
	return (
		<DiscussView
			editionId={edition.id}
			isReady={isReady}
			status={status}
			conversations={conversations}
		/>
	);
}
