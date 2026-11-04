import { getRouteApi, Link } from "@tanstack/react-router";
import { ReadingPositionControl } from "#/components/reading-position";
import { Badge } from "#/components/ui/badge";

const bookRoute = getRouteApi("/books/$editionId");

/**
 * The book page's loader data, shared by every tab, with `isReady`: whether
 * the edition finished importing. Tabs that need a ready book (the Guide,
 * Discuss's composer) check it.
 */
export function useBook() {
	const data = bookRoute.useLoaderData();
	return { ...data, isReady: data.edition.status === "ready" };
}

/**
 * Cover, title, authors, and either the import status (not ready) or the
 * reading position with progress (ready). A row on phones, a rail on desktop.
 */
export function BookHeader() {
	const { edition, isReady } = useBook();
	return (
		<header className="lg:sticky lg:top-6 lg:self-start">
			<p className="text-sm">
				<Link to="/" className="text-muted-foreground hover:underline">
					← Library
				</Link>
			</p>
			<div className="mt-3 flex gap-4 lg:flex-col">
				{edition.coverPath && (
					<img
						src={`/api/covers/${edition.id}`}
						alt=""
						className="aspect-[2/3] w-20 shrink-0 self-start rounded-md border object-cover sm:w-28 lg:w-full"
					/>
				)}
				<div className="min-w-0 flex-1 space-y-2">
					<div>
						<h1 className="font-serif text-xl font-semibold leading-tight break-words sm:text-2xl">
							{edition.title}
						</h1>
						{edition.authors.length > 0 && (
							<p className="mt-1 text-muted-foreground">
								{edition.authors.join(", ")}
							</p>
						)}
					</div>
					{isReady ? (
						<ReadingPositionControl editionId={edition.id} />
					) : (
						<div className="space-y-1">
							<Badge
								variant={
									edition.displayStatus === "failed"
										? "destructive"
										: "secondary"
								}
								data-testid="import-status"
							>
								{edition.displayStatus}
							</Badge>
							{edition.error && (
								<p className="text-sm break-words text-destructive-foreground">
									{edition.error}
								</p>
							)}
						</div>
					)}
				</div>
			</div>
		</header>
	);
}

/**
 * The current tab is styled from the router's `aria-current="page"` rather
 * than `activeProps` classes: those are appended to these, and Tailwind orders
 * same-property utilities itself, so `border-transparent` and
 * `text-muted-foreground` would still win.
 */
const TAB =
	"-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 whitespace-nowrap text-muted-foreground hover:text-foreground pointer-coarse:py-3 aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground";

/**
 * The book's tabs as links: each is a page with its own URL, and the router
 * marks the current one with `aria-current="page"`. The Guide is current on
 * every `/guide/*` path and is only offered for ready editions.
 */
export function BookTabs() {
	const { edition, isReady } = useBook();
	const params = { editionId: edition.id };
	return (
		<nav
			aria-label="Book"
			className="flex gap-1 overflow-x-auto border-b text-sm"
			data-testid="book-tabs"
		>
			<Link
				to="/books/$editionId"
				params={params}
				activeOptions={{ exact: true, includeSearch: false }}
				className={TAB}
			>
				Discuss
			</Link>
			{isReady && (
				<Link
					to="/books/$editionId/guide"
					params={params}
					activeOptions={{ includeSearch: false }}
					className={TAB}
				>
					Guide
				</Link>
			)}
			<Link
				to="/books/$editionId/contents"
				params={params}
				activeOptions={{ includeSearch: false }}
				className={TAB}
			>
				Contents
			</Link>
			<Link to="/books/$editionId/about" params={params} className={TAB}>
				About
			</Link>
		</nav>
	);
}
