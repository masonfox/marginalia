import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import {
	ContinueSection,
	DashboardEmpty,
	ReadingSection,
} from "#/components/dashboard";
import { listReadingShelfFn } from "#/fns/library";
import { continueQuery } from "#/lib/continue-query";
import { MAX_SHELF_QUERY, SHELF_FILTERS } from "#/lib/shelf-status";

/**
 * The books being read and the library's size. Upload, retry, and delete
 * invalidate it; it refetches on mount, so a position set on a book's page
 * shows up on return.
 */
const readingShelfQuery = queryOptions({
	queryKey: ["reading-shelf"],
	queryFn: () => listReadingShelfFn(),
});

/**
 * The library's search and filter, accepted only to redirect old library
 * URLs. Invalid values fall back to none rather than an error page.
 */
const searchSchema = z.object({
	q: z.string().max(MAX_SHELF_QUERY).optional().catch(undefined),
	status: z.enum(SHELF_FILTERS).optional().catch(undefined),
});

export const Route = createFileRoute("/")({
	head: () => ({ meta: [{ title: "Dashboard · Marginalia" }] }),
	validateSearch: searchSchema,
	// The library used to live here: send its search URLs to the Library,
	// replacing the root URL in history.
	beforeLoad: ({ search }) => {
		if (search.q !== undefined || search.status !== undefined) {
			throw redirect({
				to: "/library",
				search: { q: search.q, status: search.status },
				replace: true,
			});
		}
	},
	// Continue failing leaves the dashboard usable, so it never fails the page.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(readingShelfQuery),
			context.queryClient.ensureQueryData(continueQuery).catch(() => null),
		]),
	component: DashboardPage,
});

function DashboardPage() {
	const shelf = useQuery(readingShelfQuery);
	const recent = useQuery(continueQuery);
	const conversations = recent.data?.items ?? [];
	const reading = shelf.data?.items ?? [];
	const total = shelf.data?.total ?? 0;

	return (
		<main className="mx-auto max-w-5xl px-4 py-8">
			<h1 className="font-serif text-3xl font-semibold">Dashboard</h1>
			<ContinueSection conversations={conversations} />
			<ReadingSection items={reading} />
			{shelf.data && conversations.length === 0 && reading.length === 0 && (
				<DashboardEmpty hasBooks={total > 0} />
			)}
		</main>
	);
}
