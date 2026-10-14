import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, MessageSquarePlus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PreprocessCard } from "#/components/preprocess-card";
import { NewConversationDialog } from "#/components/scope";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button, buttonVariants } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { deleteEditionFn, getEditionFn } from "#/fns/library";
import { searchPassagesFn } from "#/fns/retrieval";
import type { TocNode } from "#/modules/catalog";
import type { SnippetPart } from "#/modules/retrieval";

export const Route = createFileRoute("/books/$editionId")({
	validateSearch: z.object({ q: z.string().optional() }),
	loader: async ({ params }) => {
		if (!z.uuid().safeParse(params.editionId).success) throw notFound();
		const data = await getEditionFn({ data: { editionId: params.editionId } });
		if (!data) throw notFound();
		return data;
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `${loaderData.edition.title} · Marginalia`
					: "Marginalia",
			},
		],
	}),
	component: BookPage,
});

function BookPage() {
	const { edition, toc, passageCount, currentParserVersion } =
		Route.useLoaderData();
	const outdated =
		edition.parserVersion !== null &&
		edition.parserVersion < currentParserVersion;
	const facts: [string, string | null][] = [
		["Language", edition.language],
		["Publisher", edition.publisher],
		["Published", edition.published],
		[
			"Identifiers",
			edition.identifiers
				.map((i) => (i.scheme ? `${i.scheme} ${i.value}` : i.value))
				.join(", ") || null,
		],
		["Passages", String(passageCount)],
		[
			"Parser version",
			edition.parserVersion === null
				? null
				: `v${edition.parserVersion}${outdated ? " (outdated)" : ""}`,
		],
	];

	return (
		<main className="mx-auto max-w-5xl px-4 py-8">
			<p className="text-sm">
				<Link to="/" className="text-muted-foreground hover:underline">
					← Library
				</Link>
			</p>
			<div className="mt-4 flex flex-col gap-6 sm:flex-row">
				{edition.coverPath && (
					<img
						src={`/api/covers/${edition.id}`}
						alt=""
						className="aspect-[2/3] w-56 shrink-0 self-start rounded-md border object-cover"
					/>
				)}
				<div className="min-w-0">
					<h1 className="font-serif text-3xl font-semibold">{edition.title}</h1>
					{edition.authors.length > 0 && (
						<p className="mt-1 text-lg text-muted-foreground">
							{edition.authors.join(", ")}
						</p>
					)}
					<div className="mt-2">
						<Badge
							variant={
								edition.displayStatus === "failed" ? "destructive" : "secondary"
							}
						>
							{edition.displayStatus}
						</Badge>
					</div>
					{edition.error && (
						<p className="mt-2 text-sm text-destructive-foreground">
							{edition.error}
						</p>
					)}
					{edition.status === "ready" && (
						<ConversationActions editionId={edition.id} />
					)}
					<dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
						{facts
							.filter(([, v]) => v)
							.map(([k, v]) => (
								<div key={k} className="contents">
									<dt className="text-muted-foreground">{k}</dt>
									<dd className="break-words">{v}</dd>
								</div>
							))}
					</dl>
					{edition.description && (
						<p className="mt-4 max-w-prose text-sm leading-relaxed">
							{edition.description}
						</p>
					)}
				</div>
			</div>

			<section className="mt-8" aria-labelledby="sources">
				<h2 id="sources" className="font-medium">
					Sources
				</h2>
				<ul className="mt-2 space-y-1 text-sm">
					{edition.sources.map((s) => (
						<li
							key={`${s.kind}:${s.label}`}
							className="flex flex-wrap items-center gap-2"
						>
							<Badge variant="outline">
								{s.kind === "upload" ? "Upload" : "Library"}
							</Badge>
							<span className="break-all">{s.label}</span>
							{!s.available && (
								<span className="text-muted-foreground">(missing)</span>
							)}
						</li>
					))}
				</ul>
				<DeleteBook
					editionId={edition.id}
					title={edition.title}
					inLibraryFolder={edition.sources.some((s) => s.kind === "filesystem")}
				/>
			</section>

			{edition.status === "ready" && <PreprocessCard editionId={edition.id} />}

			{edition.status === "ready" && <BookSearch editionId={edition.id} />}

			<section className="mt-8" aria-labelledby="contents">
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
		</main>
	);
}

function ConversationActions({ editionId }: { editionId: string }) {
	return (
		<div className="mt-4 flex flex-wrap gap-2">
			<NewConversationDialog editionId={editionId}>
				<Button type="button" size="sm">
					<MessageSquarePlus aria-hidden /> Start conversation
				</Button>
			</NewConversationDialog>
			<Link
				to="/books/$editionId/conversations"
				params={{ editionId }}
				className={buttonVariants({ variant: "outline", size: "sm" })}
			>
				<MessageSquare aria-hidden /> Conversations
			</Link>
		</div>
	);
}

function DeleteBook({
	editionId,
	title,
	inLibraryFolder,
}: {
	editionId: string;
	title: string;
	inLibraryFolder: boolean;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const remove = useServerFn(deleteEditionFn);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<AlertDialog onOpenChange={() => setError(null)}>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="outline" className="mt-4">
					<Trash2 />
					Delete book
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
					<AlertDialogDescription>
						This removes the book, its passages, its cover, and every
						conversation about it from Marginalia. This cannot be undone.
					</AlertDialogDescription>
					{inLibraryFolder && (
						<AlertDialogDescription>
							The file in your library folder is not removed. Scans will skip it
							until you upload the same file again.
						</AlertDialogDescription>
					)}
					{error && (
						<p className="text-sm text-destructive-foreground">{error}</p>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: "destructive" })}
						disabled={busy}
						onClick={async (event) => {
							// Keep the dialog open until the delete finishes.
							event.preventDefault();
							setBusy(true);
							setError(null);
							try {
								// Already deleted elsewhere also lands on the library.
								await remove({ data: { editionId } });
								await queryClient.invalidateQueries({ queryKey: ["editions"] });
								await navigate({ to: "/" });
							} catch {
								setError("The book could not be deleted. Please try again.");
								setBusy(false);
							}
						}}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
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
		<section className="mt-8" aria-labelledby="search">
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
