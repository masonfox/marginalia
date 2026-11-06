import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { coverColors } from "#/components/book-cover";
import {
	DeleteConversation,
	RenameConversationDialog,
} from "#/components/conversation-controls";
import { ScopePill } from "#/components/pieces";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useNamingMetadata } from "#/hooks/use-naming-metadata";
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
		<section aria-labelledby="book-conversations" className="space-y-5">
			<h2
				id="book-conversations"
				className="font-serif text-3xl font-semibold tracking-tight"
			>
				Conversations
			</h2>
			{conversations.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No conversations about this book yet.
				</p>
			) : (
				<ul className="divide-y border-y">
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
	| {
			bookLabel: "books";
			conversation: RecentConversation;
			metaColumn?: boolean;
	  };

/**
 * One conversation in a list: opens it when selected, with rename and
 * delete in its actions menu. Every list refreshes after either.
 */
export function ConversationRow(props: ConversationRowProps) {
	const c = useNamingMetadata(props.conversation);
	const router = useRouter();
	const queryClient = useQueryClient();
	useEffect(() => {
		if (c.deleted) {
			void router.invalidate();
			void queryClient.invalidateQueries({ queryKey: ["conversations"] });
		}
	}, [c.deleted, router, queryClient]);
	const [renaming, setRenaming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const updated = new Date(c.updatedAt);
	const metaColumn = props.bookLabel === "books" && props.metaColumn;
	const books =
		props.bookLabel === "books"
			? conversationBooksLabel(props.conversation.books)
			: null;
	const scope =
		props.bookLabel === "scope"
			? scopeText(props.conversation.scopeLabel)
			: null;
	if (c.deleted) return null;
	return (
		<li
			className="flex min-w-0 items-start gap-1 py-4 hover:bg-accent/40 sm:py-5"
			data-testid="conversation-row"
		>
			<Link
				to="/c/$conversationId"
				params={{ conversationId: c.id }}
				className="flex min-w-0 flex-1 items-start gap-3 py-1 sm:gap-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			>
				{props.bookLabel === "books" ? (
					<CoverStack books={props.conversation.books} />
				) : null}
				<span className="block min-w-0 flex-1">
					<span
						className="block line-clamp-2 text-[15.5px] leading-snug font-semibold sm:text-[17px]"
						data-testid="conversation-title"
					>
						{c.title}
					</span>
					<span
						className="mt-1 block line-clamp-2 text-[13.5px] text-muted-foreground sm:text-sm"
						data-testid="conversation-preview"
					>
						{c.preview ?? <em>No messages yet</em>}
					</span>
					<span className="relative mt-2 flex min-w-0 flex-wrap gap-y-1 text-xs text-faint-foreground sm:text-[12.5px]">
						{books ? (
							<span className="truncate" data-testid="conversation-books">
								<span aria-hidden>{books.text}</span>
								<span className="sr-only top-0 left-0">
									{books.description}
								</span>
							</span>
						) : (
							<span className="truncate" data-testid="conversation-scope">
								{scope}
							</span>
						)}
						{props.bookLabel === "books" &&
							props.conversation.books.length === 1 && (
								<ScopePill
									icon={false}
									className="ml-2 min-h-0 py-0.5 text-[10px]"
								>
									{scopeText(props.conversation.books[0]?.scopeLabel ?? null)}
								</ScopePill>
							)}
						<span
							className={metaColumn ? "shrink-0 sm:hidden" : "shrink-0"}
							aria-hidden
						>
							&nbsp;&middot;&nbsp;
						</span>
						<time
							className={metaColumn ? "shrink-0 sm:hidden" : "shrink-0"}
							dateTime={updated.toISOString()}
							title={updated.toLocaleString()}
							suppressHydrationWarning
						>
							{relativeTime(updated)}
						</time>
					</span>
				</span>
			</Link>
			{metaColumn && (
				<time
					className="hidden w-[110px] shrink-0 pt-1 text-right text-[12.5px] text-faint-foreground sm:block"
					dateTime={updated.toISOString()}
					title={updated.toLocaleString()}
					suppressHydrationWarning
				>
					{relativeTime(updated)}
				</time>
			)}
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="mt-0.5 shrink-0 pointer-coarse:size-11"
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
						className="absolute block h-15 w-10 overflow-hidden rounded-[2px_4px_4px_2px] shadow-cover"
						style={{
							left: inset + i * STACK_DX,
							top: i * STACK_DY,
							zIndex: shown.length - i,
							...(b.hasCover ? {} : coverColors(b.title)),
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
							<span className="flex size-full items-center justify-center font-serif text-sm font-semibold">
								{b.title.trim().charAt(0).toUpperCase()}
							</span>
						)}
					</span>
				))
				.reverse()}
		</span>
	);
}
