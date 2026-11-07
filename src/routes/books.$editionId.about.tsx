import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
	Check,
	Copy,
	ExternalLink,
	FolderOpen,
	Trash2,
	TriangleAlert,
	Upload,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useBook } from "#/components/book-page";
import { EYEBROW } from "#/components/pieces";
import { PreprocessCard } from "#/components/preprocess-card";
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
import {
	formatCount,
	formatPublished,
	type IdentifierRow,
	identifierRows,
	languageName,
	type PublishedDate,
} from "#/lib/edition-facts";
import { readerContentWarning } from "#/lib/reader-content";

export const Route = createFileRoute("/books/$editionId/about")({
	component: AboutTab,
});

/** Section headings share one quiet, small-caps style so the content leads. */
const HEADING = EYEBROW;

/** Blurbs longer than this start clamped, with a Show more toggle. */
const LONG_DESCRIPTION = 1200;

/**
 * Description, details, identifiers, files, and deleting the book. On desktop
 * the description and files read down the left and the details sit in a card
 * on the right; on phones everything stacks in reading order.
 */
function AboutTab() {
	const { edition, passageCount, currentParserVersion } = useBook();
	const outdated =
		edition.parserVersion !== null &&
		edition.parserVersion < currentParserVersion;
	const ids = identifierRows(edition.identifiers);

	return (
		<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-14">
			{edition.description && (
				<section aria-labelledby="about-description" className="min-w-0">
					<h2 id="about-description" className={HEADING}>
						Description
					</h2>
					<Description text={edition.description} />
				</section>
			)}

			<div className="min-w-0 lg:col-start-1">
				<PreprocessCard editionId={edition.id} />
			</div>

			<section aria-labelledby="about-files" className="min-w-0 lg:col-start-1">
				<h2 id="about-files" className={HEADING}>
					Files
				</h2>
				{edition.sources.length === 0 ? (
					<p className="mt-3 text-sm text-muted-foreground">
						No file is linked to this book.
					</p>
				) : (
					<ul className="mt-4 divide-y rounded-2xl border bg-card">
						{edition.sources.map((s) => (
							<li
								key={`${s.kind}:${s.label}`}
								className="flex items-start gap-4 px-5 py-5 text-sm"
							>
								{s.kind === "upload" ? (
									<Upload
										className="mt-0.5 size-4 shrink-0 text-muted-foreground"
										aria-hidden
									/>
								) : (
									<FolderOpen
										className="mt-0.5 size-4 shrink-0 text-muted-foreground"
										aria-hidden
									/>
								)}
								<div className="min-w-0 flex-1">
									<p className="font-mono text-xs leading-5 break-all">
										{s.label}
									</p>
									<p className="text-xs text-muted-foreground">
										{s.kind === "upload" ? "Uploaded" : "Library folder"}
									</p>
								</div>
								{!s.available && (
									<Badge variant="status" className="text-status-unavailable">
										Missing
									</Badge>
								)}
							</li>
						))}
					</ul>
				)}
			</section>

			<section
				aria-labelledby="about-delete"
				className="min-w-0 self-start rounded-2xl border border-destructive-foreground/30 p-6 lg:col-start-1"
			>
				<h2 id="about-delete" className="text-sm font-medium">
					Delete this book
				</h2>
				<p className="mt-1 mb-3 max-w-prose text-sm text-muted-foreground">
					Removes the book, its passages, and every conversation about it from
					Marginalia.
				</p>
				<DeleteBook
					editionId={edition.id}
					title={edition.title}
					inLibraryFolder={edition.sources.some((s) => s.kind === "filesystem")}
				/>
			</section>
			<aside
				aria-label="Book details"
				className="min-w-0 space-y-8 lg:col-start-2 lg:row-span-4 lg:row-start-1"
			>
				<Details
					language={languageName(edition.language)}
					publisher={edition.publisher}
					published={formatPublished(edition.published)}
					epubVersion={edition.epubVersion}
					passages={passageCount}
					parserVersion={edition.parserVersion}
					currentParserVersion={currentParserVersion}
					outdated={outdated}
				/>
				{ids.length > 0 && <Identifiers rows={ids} />}
			</aside>
		</div>
	);
}

function Description({ text }: { text: string }) {
	const long = text.length > LONG_DESCRIPTION;
	const [expanded, setExpanded] = useState(false);
	const id = useId();
	return (
		<>
			<p
				id={id}
				className={`mt-4 max-w-prose font-reading text-xl leading-[1.7] text-pretty${long && !expanded ? " line-clamp-[10]" : ""}`}
			>
				{text}
			</p>
			{long && (
				<Button
					variant="link"
					size="xs"
					className="mt-1 px-0"
					aria-expanded={expanded}
					aria-controls={id}
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? "Show less" : "Show more"}
				</Button>
			)}
		</>
	);
}

function Details({
	language,
	publisher,
	published,
	epubVersion,
	passages,
	parserVersion,
	currentParserVersion,
	outdated,
}: {
	language: string | null;
	publisher: string | null;
	published: PublishedDate | null;
	epubVersion: string | null;
	passages: number;
	parserVersion: number | null;
	currentParserVersion: number;
	outdated: boolean;
}) {
	return (
		<section
			aria-labelledby="about-details"
			className="rounded-2xl border bg-card p-6 text-card-foreground"
		>
			<h2 id="about-details" className={HEADING}>
				Details
			</h2>
			<dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 text-[15px]">
				{publisher && (
					<Fact term="Publisher" wide>
						{publisher}
					</Fact>
				)}
				{published && (
					<Fact term="Published">
						{published.dateTime ? (
							<time dateTime={published.dateTime}>{published.label}</time>
						) : (
							published.label
						)}
					</Fact>
				)}
				{language && <Fact term="Language">{language}</Fact>}
				{epubVersion && <Fact term="Format">EPUB {epubVersion}</Fact>}
				<Fact term="Passages">
					<span className="tabular-nums">{formatCount(passages)}</span>
				</Fact>
				{parserVersion !== null && (
					<Fact term="Parser version" wide={outdated}>
						<span className="tabular-nums">v{parserVersion}</span>
						{outdated && (
							<span className="mt-1.5 flex items-start gap-1.5 rounded-md border border-status-unavailable/30 bg-status-unavailable/10 px-2 py-1.5 text-xs text-status-unavailable">
								<TriangleAlert
									className="mt-px size-3.5 shrink-0"
									aria-hidden
								/>
								<span>
									Outdated: imported before parser v{currentParserVersion}.
								</span>
							</span>
						)}
					</Fact>
				)}
			</dl>
		</section>
	);
}

function Fact({
	term,
	wide = false,
	children,
}: {
	term: string;
	/** Spans both columns, for values too long to share a row. */
	wide?: boolean;
	children: ReactNode;
}) {
	return (
		<div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
			<dt className="text-xs text-muted-foreground">{term}</dt>
			<dd className="mt-0.5 break-words">{children}</dd>
		</div>
	);
}

function Identifiers({ rows }: { rows: IdentifierRow[] }) {
	const shown = rows.filter((r) => !r.internal);
	const internal = rows.filter((r) => r.internal);
	return (
		<section
			aria-labelledby="about-identifiers"
			className="rounded-2xl border bg-card p-6"
		>
			<h2 id="about-identifiers" className={HEADING}>
				Identifiers
			</h2>
			{shown.length > 0 && <IdentifierList rows={shown} />}
			{internal.length > 0 && (
				<details className="mt-2 text-sm">
					<summary className="cursor-pointer rounded-sm text-xs text-muted-foreground select-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
						{shown.length > 0 ? "Other identifiers" : "Internal identifiers"} (
						{internal.length})
					</summary>
					<IdentifierList rows={internal} />
				</details>
			)}
		</section>
	);
}

function IdentifierList({ rows }: { rows: IdentifierRow[] }) {
	return (
		<dl className="mt-3 divide-y">
			{rows.map((r) => (
				<div
					key={r.key}
					className="group/id flex flex-wrap items-center gap-2 py-3 text-sm"
				>
					<dt className="w-20 shrink-0 text-xs text-muted-foreground">
						{r.label}
					</dt>
					<dd className="flex min-w-0 flex-1 items-center gap-1">
						<IdentifierValue row={r} />
					</dd>
				</div>
			))}
		</dl>
	);
}

/** The value, linked when the page is unambiguous, and a button to copy it. */
function IdentifierValue({ row }: { row: IdentifierRow }) {
	const valueRef = useRef<HTMLSpanElement>(null);
	const [status, setStatus] = useState<"idle" | "copied" | "selected">("idle");
	useEffect(() => {
		if (status === "idle") return;
		const timer = setTimeout(() => setStatus("idle"), 2000);
		return () => clearTimeout(timer);
	}, [status]);
	const copy = async () => {
		try {
			if (!navigator.clipboard) throw new Error("no clipboard");
			await navigator.clipboard.writeText(row.value);
			setStatus("copied");
		} catch {
			// Plain HTTP has no clipboard API: select the value to copy by hand.
			const node = valueRef.current;
			const selection = window.getSelection();
			if (node && selection) {
				const range = document.createRange();
				range.selectNodeContents(node);
				selection.removeAllRanges();
				selection.addRange(range);
			}
			setStatus("selected");
		}
	};
	const value = (
		<span ref={valueRef} className="font-mono text-xs break-all">
			{row.value}
		</span>
	);
	return (
		<>
			<span className="min-w-0 flex-1">
				{row.href ? (
					<a
						href={row.href}
						target="_blank"
						rel="noreferrer noopener"
						className="inline-flex max-w-full items-center gap-1 underline-offset-2 hover:underline"
					>
						{value}
						<ExternalLink
							className="size-3 shrink-0 text-muted-foreground"
							aria-hidden
						/>
						<span className="sr-only">(opens in a new tab)</span>
					</a>
				) : (
					value
				)}
			</span>
			<Button
				variant="ghost"
				size="icon-xs"
				className="text-muted-foreground max-sm:size-11"
				aria-label={`Copy ${row.label} ${row.value}`}
				onClick={() => void copy()}
			>
				{status === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
			</Button>
			<output aria-live="polite" className="sr-only">
				{status === "copied"
					? `${row.label} copied.`
					: status === "selected"
						? `${row.label} selected: press Control C to copy.`
						: ""}
			</output>
		</>
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
				<Button size="sm" variant="destructive-outline">
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
									queryClient.invalidateQueries({
										queryKey: ["reading-shelf"],
									}),
								]);
								await navigate({ to: "/library" });
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
