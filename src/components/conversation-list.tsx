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
import { conversationBooksLabel, scopeText } from "#/lib/conversation-books";
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
	const messages = `${c.messageCount} message${c.messageCount === 1 ? "" : "s"}`;
	const updated = new Date(c.updatedAt);
	const books =
		props.bookLabel === "books"
			? conversationBooksLabel(props.conversation.books)
			: null;
	const scope =
		props.bookLabel === "scope"
			? scopeText(props.conversation.scopeLabel)
			: null;
	const lastActive = (
		<>
			{messages} · last active{" "}
			<time dateTime={updated.toISOString()} suppressHydrationWarning>
				{updated.toLocaleString()}
			</time>
		</>
	);
	return (
		<li
			className="flex items-start gap-1 hover:bg-accent/40"
			data-testid="conversation-row"
		>
			<Link
				to="/c/$conversationId"
				params={{ conversationId: c.id }}
				className="min-w-0 flex-1 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			>
				<span
					className="block truncate font-medium"
					data-testid="conversation-title"
				>
					{c.title}
				</span>
				{books ? (
					<>
						<span
							className="relative block truncate text-xs text-muted-foreground"
							data-testid="conversation-books"
						>
							<span aria-hidden>{books.text}</span>
							<span className="sr-only">{books.description}</span>
						</span>
						<span className="block truncate text-xs text-muted-foreground">
							{lastActive}
						</span>
					</>
				) : (
					<span className="block truncate text-xs text-muted-foreground">
						<span data-testid="conversation-scope">{scope}</span> · {lastActive}
					</span>
				)}
				<span
					className="mt-0.5 block truncate text-sm text-muted-foreground"
					data-testid="conversation-preview"
				>
					{c.preview ?? <em>No messages yet</em>}
				</span>
			</Link>
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="mt-1.5 mr-1.5 shrink-0"
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
