import { Link, useRouter } from "@tanstack/react-router";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	DeleteConversation,
	RenameConversationDialog,
} from "#/components/conversation-controls";
import { scopeText } from "#/components/scope";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import type { ConversationSummary } from "#/modules/conversation";

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
						<ConversationRow key={c.id} conversation={c} />
					))}
				</ul>
			)}
		</section>
	);
}

function ConversationRow({
	conversation: c,
}: {
	conversation: ConversationSummary;
}) {
	const router = useRouter();
	const [renaming, setRenaming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const messages = `${c.messageCount} message${c.messageCount === 1 ? "" : "s"}`;
	const updated = new Date(c.updatedAt);
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
				<span className="block truncate text-xs text-muted-foreground">
					<span data-testid="conversation-scope">
						{scopeText(c.scopeLabel)}
					</span>{" "}
					· {messages} · last active{" "}
					<time dateTime={updated.toISOString()} suppressHydrationWarning>
						{updated.toLocaleString()}
					</time>
				</span>
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
