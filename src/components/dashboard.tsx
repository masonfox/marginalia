import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { BookCover } from "#/components/book-cover";
import { ConversationRow } from "#/components/conversation-list";
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
			className="mt-6 space-y-2"
			data-testid="continue-conversations"
		>
			<div className="flex items-baseline justify-between gap-4">
				<h2 id="continue-conversations" className="font-medium">
					Continue
				</h2>
				<Link to="/conversations" className={sectionLinkClass}>
					See all conversations
				</Link>
			</div>
			<ul className="divide-y rounded-md border">
				{conversations.map((c) => (
					<ConversationRow key={c.id} bookLabel="books" conversation={c} />
				))}
			</ul>
		</section>
	);
}

/** Cards shown on narrow viewports; the rest are hidden there. */
const PHONE_CARDS = 2;

/**
 * The books being read, most recently updated position first, with a link
 * to the Library filtered to Reading. Not shown when nothing is being read.
 * Every card is rendered and those past the second are hidden below `sm`,
 * so the server and client render the same markup at any width.
 */
export function ReadingSection({ items }: { items: ReadingShelfItem[] }) {
	if (items.length === 0) return null;
	return (
		<section
			aria-labelledby="reading-shelf"
			className="mt-8 space-y-3"
			data-testid="reading-shelf"
		>
			<div className="flex items-baseline justify-between gap-4">
				<h2 id="reading-shelf" className="font-medium">
					Reading
				</h2>
				<Link
					to="/library"
					search={{ status: "reading" }}
					className={sectionLinkClass}
				>
					See all books you're reading
				</Link>
			</div>
			<ul className="grid grid-cols-2 gap-6 sm:grid-cols-4">
				{items.map((book, i) => (
					<li
						key={book.id}
						className={i >= PHONE_CARDS ? "max-sm:hidden" : undefined}
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
							/>
							<h3 className="mt-2 line-clamp-2 font-medium break-words group-hover:underline">
								{book.title}
							</h3>
						</Link>
						{book.authors.length > 0 && (
							<p className="line-clamp-1 text-sm break-words text-muted-foreground">
								{book.authors.join(", ")}
							</p>
						)}
						{book.scopeLabel && (
							<p className="mt-1 line-clamp-2 text-sm break-words text-muted-foreground">
								Through {book.scopeLabel}
							</p>
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
