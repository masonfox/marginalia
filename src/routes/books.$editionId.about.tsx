import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useBook } from "#/components/book-page";
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
import { countReaderContentFn } from "#/fns/guide";
import { deleteEditionFn } from "#/fns/library";
import { readerContentWarning } from "#/lib/reader-content";

export const Route = createFileRoute("/books/$editionId/about")({
	component: AboutTab,
});

/** Description, facts, sources, and deleting the book. */
function AboutTab() {
	const { edition, passageCount, currentParserVersion } = useBook();
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
		<div className="space-y-8">
			{edition.description && (
				<p className="max-w-prose text-sm leading-relaxed">
					{edition.description}
				</p>
			)}
			<dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
				{facts
					.filter(([, v]) => v)
					.map(([k, v]) => (
						<div key={k} className="contents">
							<dt className="text-muted-foreground">{k}</dt>
							<dd className="break-all">{v}</dd>
						</div>
					))}
			</dl>
			<section aria-labelledby="sources">
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
							<span className="min-w-0 break-all">{s.label}</span>
							{!s.available && (
								<span className="text-muted-foreground">(missing)</span>
							)}
						</li>
					))}
				</ul>
			</section>
			<DeleteBook
				editionId={edition.id}
				title={edition.title}
				inLibraryFolder={edition.sources.some((s) => s.kind === "filesystem")}
			/>
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
	const [open, setOpen] = useState(false);
	// Fresh on every opening: notes and guide edits may change in another tab.
	const content = useQuery({
		queryKey: ["reader-content", editionId],
		queryFn: () => countReaderContentFn({ data: { editionId } }),
		enabled: open,
		staleTime: 0,
	});
	const warning = content.data ? readerContentWarning(content.data) : null;
	// Delete waits for this opening's count, so the warning is never skipped.
	const counted = content.isSuccess && !content.isFetching;
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				setError(null);
			}}
		>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="outline">
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
					{warning && (
						<AlertDialogDescription
							className="font-medium text-foreground"
							data-testid="delete-reader-content"
						>
							{warning}
						</AlertDialogDescription>
					)}
					{inLibraryFolder && (
						<AlertDialogDescription>
							The file in your library folder is not removed. Scans will skip it
							until you upload the same file again.
						</AlertDialogDescription>
					)}
					{content.isError && !content.isFetching && (
						<div
							className="flex items-center gap-2 text-sm text-destructive-foreground"
							data-testid="delete-reader-content-error"
						>
							<span>Could not check for your notes and guide edits.</span>
							<Button
								size="xs"
								variant="outline"
								onClick={() => void content.refetch()}
							>
								Try again
							</Button>
						</div>
					)}
					{error && (
						<p className="text-sm text-destructive-foreground">{error}</p>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: "destructive" })}
						disabled={busy || !counted}
						onClick={async (event) => {
							// Keep the dialog open until the delete finishes.
							event.preventDefault();
							setBusy(true);
							setError(null);
							try {
								// Already deleted elsewhere also lands on the library.
								await remove({ data: { editionId } });
								await Promise.all([
									queryClient.invalidateQueries({ queryKey: ["editions"] }),
									queryClient.invalidateQueries({ queryKey: ["shelf"] }),
								]);
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
