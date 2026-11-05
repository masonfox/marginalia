import { Link, useRouter } from "@tanstack/react-router";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	DeleteConversation,
	RenameConversationDialog,
} from "#/components/conversation-controls";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	conversationBooksLabel,
	MAX_CONVERSATION_BOOKS,
	scopeText,
} from "#/lib/conversation-books";
import { relativeTime } from "#/lib/relative-time";
import type {
	ConversationSummary,
	RecentConversation,
} from "#/modules/conversation";

/**
 * A book's conversations, most recently active first (as listed by the
 * server). Each row opens its conversation; its actions menu renames or
 * deletes it.
 */
export function ConversationList({
	conversations,
}: {
	conversations: ConversationSummary[];
}) {
	return (
		<section aria-labelledby="book-conversations" className="space-y-2">
			<h2 id="book-conversations" className="font-medium">
				Conversations
			</h2>
			{conversations.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No conversations about this book yet.
				</p>
			) : (
				<ul className="divide-y rounded-md border">
					{conversations.map((c) => (
						<ConversationRow key={c.id} bookLabel="scope" conversation={c} />
					))}
				</ul>
			)}
		</section>
	);
}

/**
 * How a row names the conversation's books: `scope` on a book's own list,
 * where only that book's scope is shown, and `books` on lists across books.
 */
export type ConversationRowProps =
	| { bookLabel: "scope"; conversation: ConversationSummary }
	| { bookLabel: "books"; conversation: RecentConversation };

/**
 * One conversation in a list: opens it when selected, with rename and
 * delete in its actions menu. Every list refreshes after either.
 */
export function ConversationRow(props: ConversationRowProps) {
	const c = props.conversation;
	const router = useRouter();
	const [renaming, setRenaming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const updated = new Date(c.updatedAt);
	const books =
		props.bookLabel === "books"
			? conversationBooksLabel(props.conversation.books)
			: null;
	const scope =
		props.bookLabel === "scope"
			? scopeText(props.conversation.scopeLabel)
			: null;
	return (
		<li
			className="flex items-start gap-1 hover:bg-accent/40"
			data-testid="conversation-row"
		>
			<Link
				to="/c/$conversationId"
				params={{ conversationId: c.id }}
				className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			>
				{props.bookLabel === "books" ? (
					<CoverStack books={props.conversation.books} />
				) : null}
				<span className="block min-w-0 flex-1">
					<span
						className="block truncate font-medium"
						data-testid="conversation-title"
					>
						{c.title}
					</span>
					<span
						className="block truncate text-sm text-muted-foreground"
						data-testid="conversation-preview"
					>
						{c.preview ?? <em>No messages yet</em>}
					</span>
					<span className="relative mt-0.5 flex min-w-0 text-xs whitespace-nowrap text-muted-foreground/80">
						{books ? (
							<span className="truncate" data-testid="conversation-books">
								<span aria-hidden>{books.text}</span>
								<span className="sr-only">{books.description}</span>
							</span>
						) : (
							<span className="truncate" data-testid="conversation-scope">
								{scope}
							</span>
						)}
						<span className="shrink-0">&nbsp;·&nbsp;</span>
						<time
							className="shrink-0"
							dateTime={updated.toISOString()}
							title={updated.toLocaleString()}
							suppressHydrationWarning
						>
							{relativeTime(updated)}
						</time>
					</span>
				</span>
			</Link>
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="mt-1.5 mr-1.5 shrink-0 pointer-coarse:size-11"
						aria-label={`Actions for “${c.title}”`}
					>
						<Ellipsis aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => setRenaming(true)}>
						<Pencil aria-hidden /> Rename
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => setDeleting(true)}
					>
						<Trash2 aria-hidden /> Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<RenameConversationDialog
				conversationId={c.id}
				title={c.title}
				open={renaming}
				onOpenChange={setRenaming}
			/>
			<DeleteConversation
				conversationId={c.id}
				title={c.title}
				open={deleting}
				onOpenChange={setDeleting}
				onDeleted={async () => {
					await router.invalidate();
					setDeleting(false);
				}}
			/>
		</li>
	);
}

/** How far each cover behind sits right of and below the one in front, in pixels. */
const STACK_DX = 8;
const STACK_DY = 3;

/**
 * The conversation's book covers as a small stack, first book in front and
 * the others peeking out behind it to the right. The stack's width is the
 * same for any number of books so rows stay aligned. Decorative: the row's
 * text already names every book for assistive technology.
 */
export function CoverStack({
	books,
}: {
	books: { editionId: string; title: string; hasCover: boolean }[];
}) {
	const shown = books.slice(0, MAX_CONVERSATION_BOOKS);
	// Centre the stack in the slot sized for the most books, so a single
	// cover does not leave a wide gap before the row's text.
	const inset = ((MAX_CONVERSATION_BOOKS - shown.length) * STACK_DX) / 2;
	return (
		<span
			aria-hidden
			className="relative mt-0.5 block h-[66px] w-14 shrink-0"
			data-testid="conversation-covers"
		>
			{shown
				.map((b, i) => (
					<span
						key={b.editionId}
						className="absolute block h-15 w-10 overflow-hidden rounded-sm border bg-muted shadow-sm"
						style={{
							left: inset + i * STACK_DX,
							top: i * STACK_DY,
							zIndex: shown.length - i,
						}}
					>
						{b.hasCover ? (
							<img
								src={`/api/covers/${b.editionId}`}
								alt=""
								loading="lazy"
								className="size-full object-cover"
							/>
						) : (
							<span className="flex size-full items-center justify-center font-serif text-sm text-muted-foreground">
								{b.title.trim().charAt(0).toUpperCase()}
							</span>
						)}
					</span>
				))
				.reverse()}
		</span>
	);
}
