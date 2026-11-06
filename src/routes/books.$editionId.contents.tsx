import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Search } from "lucide-react";
import { z } from "zod";
import { useBook } from "#/components/book-page";
import { ScopePill } from "#/components/pieces";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { searchPassagesFn } from "#/fns/retrieval";
import { useReadingPosition } from "#/hooks/use-reading-position";
import type { TocNode } from "#/modules/catalog";
import type { ReadingPosition } from "#/modules/guide";
import type { SnippetPart } from "#/modules/retrieval";

export const Route = createFileRoute("/books/$editionId/contents")({
	validateSearch: z.object({ q: z.string().optional() }),
	component: ContentsTab,
});

/** In-book search and the nested table of contents. */
function ContentsTab() {
	const { edition, toc, isReady } = useBook();
	const { position, units } = useReadingPosition(edition.id, {
		enabled: isReady,
	});
	const current =
		position?.kind === "unit"
			? units?.filter((unit) => unit.endPosition <= position.maxPosition).at(-1)
					?.startLocator
			: undefined;
	return (
		<div className="mx-auto max-w-[836px] space-y-8">
			{isReady && <BookSearch editionId={edition.id} />}
			<section aria-labelledby="contents">
				<h2 id="contents" className="sr-only">
					Contents
				</h2>
				{toc.length === 0 ? (
					<p className="mt-2 text-sm text-muted-foreground">
						This book has no table of contents.
					</p>
				) : (
					<TocList nodes={toc} position={position} current={current} />
				)}
			</section>
		</div>
	);
}

/** A TOC entry is read only when its target falls within the saved position. */
export function tocState(
	node: TocNode,
	position: ReadingPosition | null,
	current?: string,
) {
	if (node.locator && node.locator === current) return "current";
	if (!position || node.revealPosition === null) return "unset";
	return position.kind === "finished" ||
		node.revealPosition <= position.maxPosition
		? "read"
		: "later";
}
function TocList({
	nodes,
	position,
	current,
	nested = false,
}: {
	nodes: TocNode[];
	position: ReadingPosition | null;
	current?: string;
	nested?: boolean;
}) {
	return (
		<ol className={nested ? "ml-5 border-l pl-3 sm:ml-8 sm:pl-5" : "border-b"}>
			{nodes.map((node) => {
				const state = tocState(node, position, current);
				return (
					<li key={`${node.locator ?? "-"}:${node.label}`}>
						<div
							data-reading-state={state}
							className={`flex min-h-14 items-center gap-3 border-t px-3 py-3 sm:gap-5 sm:px-4 ${state === "current" ? "rounded-lg bg-amber-soft" : ""}`}
						>
							<span
								aria-hidden
								className={`flex size-[18px] shrink-0 items-center justify-center rounded-full ${state === "read" || state === "current" ? "bg-amber-soft text-amber-foreground" : "border border-input"}`}
							>
								{(state === "read" || state === "current") && (
									<Check className="size-3" />
								)}
							</span>
							<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
								{node.locator ? (
									<Link
										to="/p/$locator"
										params={{ locator: node.locator }}
										aria-current={state === "current" ? "location" : undefined}
										className={`min-w-0 break-words text-[15px] hover:underline ${state === "later" ? "text-muted-foreground" : "text-foreground"}`}
									>
										{node.label}
									</Link>
								) : (
									<span className="text-muted-foreground">{node.label}</span>
								)}
								{state === "current" && <ScopePill>Your position</ScopePill>}
							</div>
						</div>
						{node.children.length > 0 && (
							<TocList
								nodes={node.children}
								position={position}
								current={current}
								nested
							/>
						)}
					</li>
				);
			})}
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
			<h2
				id="search"
				className="text-[11px] font-semibold tracking-[0.14em] text-faint-foreground uppercase"
			>
				Search this book
			</h2>
			<form
				className="mt-3 flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					const value = new FormData(e.currentTarget).get("q");
					void navigate({
						search: { q: typeof value === "string" ? value : undefined },
					});
				}}
			>
				<Input
					className="min-w-0 flex-1"
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
						<li key={hit.locator} className="rounded-2xl border bg-card p-4">
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
								<p className="mt-2 font-reading text-lg leading-relaxed">
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
