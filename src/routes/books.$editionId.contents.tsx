import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { z } from "zod";
import { useBook } from "#/components/book-page";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { searchPassagesFn } from "#/fns/retrieval";
import type { TocNode } from "#/modules/catalog";
import type { SnippetPart } from "#/modules/retrieval";

export const Route = createFileRoute("/books/$editionId/contents")({
	validateSearch: z.object({ q: z.string().optional() }),
	component: ContentsTab,
});

/** In-book search and the nested table of contents. */
function ContentsTab() {
	const { edition, toc, isReady } = useBook();
	return (
		<div className="space-y-8">
			{isReady && <BookSearch editionId={edition.id} />}
			<section aria-labelledby="contents">
				<h2 id="contents" className="font-medium">
					Contents
				</h2>
				{toc.length === 0 ? (
					<p className="mt-2 text-sm text-muted-foreground">
						This book has no table of contents.
					</p>
				) : (
					<TocList nodes={toc} />
				)}
			</section>
		</div>
	);
}

function TocList({ nodes }: { nodes: TocNode[] }) {
	return (
		<ol className="mt-2 space-y-1 border-l pl-4 text-sm">
			{nodes.map((node) => (
				<li key={`${node.locator ?? "-"}:${node.label}`}>
					{node.locator ? (
						<Link
							to="/p/$locator"
							params={{ locator: node.locator }}
							className="hover:underline"
						>
							{node.label}
						</Link>
					) : (
						<span className="text-muted-foreground">{node.label}</span>
					)}
					{node.children.length > 0 && <TocList nodes={node.children} />}
				</li>
			))}
		</ol>
	);
}

function BookSearch({ editionId }: { editionId: string }) {
	const { q } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const query = q?.trim() ?? "";
	const results = useQuery({
		queryKey: ["search", editionId, query],
		queryFn: () => searchPassagesFn({ data: { editionId, query, limit: 50 } }),
		enabled: query.length > 0,
	});

	return (
		<section aria-labelledby="search">
			<h2 id="search" className="font-medium">
				Search this book
			</h2>
			<form
				className="mt-2 flex max-w-xl gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					const value = new FormData(e.currentTarget).get("q");
					void navigate({
						search: { q: typeof value === "string" ? value : undefined },
					});
				}}
			>
				<Input
					name="q"
					defaultValue={q}
					placeholder='Words, "a phrase", -excluded'
					aria-label="Search text"
				/>
				<Button type="submit">
					<Search aria-hidden /> Search
				</Button>
			</form>
			{query && results.isFetching && !results.data && (
				<p className="mt-3 text-sm text-muted-foreground">Searching…</p>
			)}
			{query && results.data?.length === 0 && (
				<p className="mt-3 text-sm text-muted-foreground">
					No passages matched “{query}”.
				</p>
			)}
			{results.data && results.data.length > 0 && (
				<ol className="mt-4 space-y-3">
					{results.data.map((hit) => (
						<li key={hit.locator} className="rounded-md border p-3">
							<Link
								to="/p/$locator"
								params={{ locator: hit.locator }}
								className="block hover:bg-accent/50"
							>
								<p className="text-xs text-muted-foreground">
									{hit.sectionTitle ?? "Untitled section"}
									{hit.kind === "footnote" ? " · note" : ""}
									{hit.position !== null ? ` · position ${hit.position}` : ""}
								</p>
								<p className="mt-1 text-sm leading-relaxed">
									<Snippet parts={hit.snippet} />
								</p>
							</Link>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

/** Renders search snippet parts; matches become <mark>, never parsed as HTML. */
function Snippet({ parts }: { parts: SnippetPart[] }) {
	let offset = 0;
	return parts.map((part) => {
		const key = offset;
		offset += part.text.length;
		return part.match ? (
			<mark
				key={key}
				className="rounded-sm bg-highlight px-0.5 text-foreground"
			>
				{part.text}
			</mark>
		) : (
			<span key={key}>{part.text}</span>
		);
	});
}
