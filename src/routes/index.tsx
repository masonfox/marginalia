import { queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import {
	ContinueReadingHero,
	ContinueSection,
	DashboardEmpty,
	ReadingSection,
} from "#/components/dashboard";
import { listReadingShelfFn, listShelfFn } from "#/fns/library";
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

	const counts = useQueries({
		queries: (["reading", "finished"] as const).map((status) => ({
			queryKey: ["shelf", "count", status],
			queryFn: () => listShelfFn({ data: { status } }),
		})),
	});
	const active = reading[0];
	const conversation = active
		? conversations.find((c) => c.books.some((b) => b.editionId === active.id))
		: undefined;
	return (
		<main>
			{active ? (
				<ContinueReadingHero book={active} conversation={conversation} />
			) : (
				<h1 className="mx-auto mt-12 max-w-[1240px] px-4 font-serif text-5xl font-semibold sm:px-8">
					Dashboard
				</h1>
			)}
			<div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-8 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-16">
				<ContinueSection conversations={conversations} />
				<div className="min-w-0 space-y-10">
					<ReadingSection items={reading} />
					<section aria-label="Your library">
						<p className="text-[11px] font-semibold tracking-[0.14em] text-faint-foreground uppercase">
							Your library
						</p>
						<Link
							to="/library"
							className="mt-3 flex min-h-11 items-center justify-between border-y text-sm"
						>
							<span className="text-muted-foreground">All books</span>
							<span className="font-serif text-3xl">{total}</span>
						</Link>
						{(["reading", "finished"] as const).map((status, i) => (
							<Link
								key={status}
								to="/library"
								search={{ status }}
								className="flex min-h-11 items-center justify-between border-b text-sm"
							>
								<span className="text-muted-foreground">
									{status === "reading" ? "Reading" : "Finished"}
								</span>
								<span className="font-serif text-3xl">
									{counts[i]?.data?.matching ?? "\u2014"}
								</span>
							</Link>
						))}
					</section>
				</div>
				{shelf.data && conversations.length === 0 && reading.length === 0 && (
					<DashboardEmpty hasBooks={total > 0} />
				)}
			</div>
		</main>
	);
}
