import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { BookCover, coverColors } from "#/components/book-cover";
import { ConversationRow } from "#/components/conversation-list";
import { NewConversation } from "#/components/new-conversation";
import { Eyebrow, ScopePill } from "#/components/pieces";
import type { RecentConversation } from "#/modules/conversation";
import type { ReadingShelfItem } from "#/modules/shelf";

const sectionLinkClass =
	"text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline pointer-coarse:py-3";

/**
 * The most recently active conversations across all books, with a link to
 * all of them. Not shown before the first conversation.
 */
export function ContinueSection({
	conversations,
}: {
	conversations: RecentConversation[];
}) {
	if (conversations.length === 0) return null;
	return (
		<section
			aria-labelledby="continue-conversations"
			className="min-w-0 space-y-5"
			data-testid="continue-conversations"
		>
			<div className="flex items-baseline justify-between gap-4">
				<h2
					id="continue-conversations"
					className="font-serif text-3xl leading-none font-semibold tracking-tight sm:text-4xl"
				>
					Recent conversations
				</h2>
				<Link to="/conversations" className={sectionLinkClass}>
					See all conversations
				</Link>
			</div>
			<ul className="divide-y border-y">
				{conversations.map((c) => (
					<ConversationRow key={c.id} bookLabel="books" conversation={c} />
				))}
			</ul>
		</section>
	);
}

/**
 * The books being read, most recently updated position first, with a link
 * to the Library filtered to Reading. Not shown when nothing is being read.
 * On phones the shelf scrolls horizontally, keeping every book reachable.
 */
export function ReadingSection({ items }: { items: ReadingShelfItem[] }) {
	if (items.length === 0) return null;
	return (
		<section
			aria-labelledby="reading-shelf"
			className="min-w-0 space-y-5"
			data-testid="reading-shelf"
		>
			<div className="flex items-baseline justify-between gap-4">
				<h2
					id="reading-shelf"
					className="font-serif text-3xl leading-none font-semibold tracking-tight sm:text-4xl"
				>
					On the nightstand
				</h2>
				<Link
					to="/library"
					search={{ status: "reading" }}
					className={sectionLinkClass}
				>
					See all books you're reading
				</Link>
			</div>
			<ul className="flex gap-4 overflow-x-auto pb-6 sm:grid sm:grid-cols-3 sm:gap-[18px]">
				{items.map((book) => (
					<li
						key={book.id}
						className="w-[120px] min-w-0 shrink-0 sm:w-auto"
						data-testid="reading-book"
					>
						<Link
							to="/books/$editionId"
							params={{ editionId: book.id }}
							className="group block"
						>
							<BookCover
								id={book.id}
								title={book.title}
								hasCover={book.hasCover}
								author={book.authors[0]}
							/>
							<h3 className="mt-3 line-clamp-2 text-[13px] leading-snug font-semibold break-words group-hover:underline">
								{book.title}
							</h3>
						</Link>
						{book.authors.length > 0 && (
							<p className="line-clamp-1 text-sm break-words text-muted-foreground">
								{book.authors.join(", ")}
							</p>
						)}
						{book.scopeLabel && (
							<ScopePill className="mt-2">{`Through ${book.scopeLabel}`}</ScopePill>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * What the dashboard shows when neither section has anything: with no books,
 * a pointer to the Library to upload one; otherwise a link to the Library.
 */
export function DashboardEmpty({ hasBooks }: { hasBooks: boolean }) {
	if (!hasBooks) {
		return (
			<div
				className="mt-12 rounded-lg border border-dashed p-10 text-center"
				data-testid="dashboard-empty"
			>
				<BookOpen
					className="mx-auto size-8 text-muted-foreground"
					aria-hidden
				/>
				<h2 className="mt-3 font-medium">No books yet</h2>
				<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
					<Link to="/library" className="underline underline-offset-4">
						Go to the Library
					</Link>{" "}
					to upload an EPUB.
				</p>
			</div>
		);
	}
	return (
		<p
			className="mt-8 text-sm text-muted-foreground"
			data-testid="dashboard-empty"
		>
			Nothing in progress yet.{" "}
			<Link to="/library" className="underline underline-offset-4">
				Choose a book from the Library
			</Link>
			.
		</p>
	);
}

/** The most recently positioned book, using its real reading bound. */
export function ContinueReadingHero({
	book,
	conversation,
}: {
	book: ReadingShelfItem;
	conversation?: RecentConversation;
}) {
	const colors = coverColors(book.title);
	return (
		<section
			aria-labelledby="continue-reading-title"
			className="relative overflow-hidden border-b"
		>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-25"
				style={{
					background: `radial-gradient(ellipse at 24% 45%, ${colors.background}, transparent 70%)`,
				}}
			/>
			<div className="relative mx-auto grid max-w-[1240px] grid-cols-[112px_minmax(0,1fr)] items-end gap-x-[18px] gap-y-5 px-4 py-8 sm:grid-cols-[196px_minmax(0,1fr)] sm:items-center sm:gap-x-14 sm:px-8 sm:py-16 lg:grid-cols-[196px_minmax(0,1fr)_300px]">
				<Link
					to="/books/$editionId"
					params={{ editionId: book.id }}
					aria-label={book.title}
					className="col-start-1 row-start-1 w-28 min-w-0 sm:row-span-2 sm:w-[196px]"
				>
					<BookCover {...book} author={book.authors[0]} loading="eager" />
				</Link>
				<div className="col-start-2 row-start-1 min-w-0">
					<Eyebrow>Continue reading</Eyebrow>
					<h1
						id="continue-reading-title"
						className="mt-2 font-serif text-[34px] leading-[1.02] font-semibold tracking-[-0.015em] break-words sm:mt-3 sm:text-[clamp(44px,5.4vw,76px)]"
					>
						{book.title}
					</h1>
					<p className="mt-2 text-sm text-muted-foreground sm:text-lg">
						{book.authors.join(", ")}
					</p>
				</div>
				<div className="col-span-2 col-start-1 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2">
					{book.scopeLabel && (
						<ScopePill>{`Through ${book.scopeLabel}`}</ScopePill>
					)}
					<div className="mt-5 flex flex-wrap gap-2.5">
						<NewConversation
							book={{ editionId: book.id, title: book.title }}
							compact={false}
						/>
						<Link
							to="/books/$editionId/contents"
							params={{ editionId: book.id }}
							className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-input px-5 text-sm font-semibold"
						>
							Contents
						</Link>
						<Link
							to="/books/$editionId/guide"
							params={{ editionId: book.id }}
							className="inline-flex min-h-11 items-center justify-center rounded-[10px] px-5 text-sm font-semibold text-muted-foreground"
						>
							Guide
						</Link>
					</div>
				</div>
				{conversation && (
					<Link
						to="/c/$conversationId"
						params={{ conversationId: conversation.id }}
						className="hidden min-w-0 rounded-2xl border bg-card/80 p-6 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:block"
					>
						<Eyebrow>Last conversation</Eyebrow>
						<p className="mt-3 text-lg leading-snug font-semibold break-words">
							{conversation.title}
						</p>
						{conversation.preview && (
							<p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
								{conversation.preview}
							</p>
						)}
					</Link>
				)}
			</div>
		</section>
	);
}
