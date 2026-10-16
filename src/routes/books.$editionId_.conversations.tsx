import {
	createFileRoute,
	Link,
	notFound,
	useRouter,
} from "@tanstack/react-router";
import { MessageSquarePlus } from "lucide-react";
import { z } from "zod";
import {
	DeleteConversation,
	RenameConversation,
} from "#/components/conversation-controls";
import { NewConversationDialog, scopeText } from "#/components/scope";
import { Button } from "#/components/ui/button";
import { getAiStatusFn, listConversationsFn } from "#/fns/conversations";
import { getEditionFn } from "#/fns/library";

export const Route = createFileRoute("/books/$editionId_/conversations")({
	loader: async ({ params }) => {
		if (!z.uuid().safeParse(params.editionId).success) throw notFound();
		const editionId = params.editionId;
		const [book, conversations, status] = await Promise.all([
			getEditionFn({ data: { editionId } }),
			listConversationsFn({ data: { editionId } }),
			getAiStatusFn(),
		]);
		if (!book) throw notFound();
		// New conversations use the chat default.
		const chat = status.chat.available ? status.chat.selection : null;
		const ai = { enabled: chat !== null, ...chat };
		return { edition: book.edition, conversations, ai };
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `Conversations about ${loaderData.edition.title} · Marginalia`
					: "Marginalia",
			},
		],
	}),
	component: ConversationsPage,
});

function ConversationsPage() {
	const { edition, conversations, ai } = Route.useLoaderData();
	const router = useRouter();
	const ready = edition.status === "ready";

	return (
		<main className="mx-auto max-w-3xl px-4 py-8">
			<p className="text-sm">
				<Link
					to="/books/$editionId"
					params={{ editionId: edition.id }}
					className="text-muted-foreground hover:underline"
				>
					← {edition.title}
				</Link>
			</p>
			<h1 className="mt-4 font-serif text-3xl font-semibold">Conversations</h1>
			<p className="mt-1 text-muted-foreground">
				About <em>{edition.title}</em>
			</p>

			{ai.enabled ? (
				<div className="mt-6 space-y-3">
					<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
						Passages the assistant reads and your messages are sent to{" "}
						{ai.provider} ({ai.model}).
					</p>
					{ready ? (
						<NewConversationDialog editionId={edition.id}>
							<Button type="button">
								<MessageSquarePlus aria-hidden /> Start a conversation
							</Button>
						</NewConversationDialog>
					) : (
						<>
							<Button type="button" disabled>
								<MessageSquarePlus aria-hidden /> Start a conversation
							</Button>
							<p className="text-sm text-muted-foreground">
								Conversations are available once the book has finished
								importing.
							</p>
						</>
					)}
				</div>
			) : (
				<AiSetupGuidance />
			)}

			<section className="mt-8" aria-labelledby="existing">
				<h2 id="existing" className="font-medium">
					Existing conversations
				</h2>
				{conversations.length === 0 ? (
					<p className="mt-2 text-sm text-muted-foreground">
						No conversations about this book yet.
					</p>
				) : (
					<ul className="mt-2 divide-y rounded-md border">
						{conversations.map((c) => (
							<li
								key={c.id}
								className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
							>
								<div className="min-w-0">
									<Link
										to="/c/$conversationId"
										params={{ conversationId: c.id }}
										className="block truncate font-medium hover:underline"
									>
										{c.title}
									</Link>
									<p className="text-xs text-muted-foreground">
										<span data-testid="conversation-scope">
											{scopeText(c.scopeLabel)}
										</span>{" "}
										· {c.messageCount} message{c.messageCount === 1 ? "" : "s"}{" "}
										· last active {new Date(c.updatedAt).toLocaleString()}
									</p>
								</div>
								<div className="flex items-center gap-1">
									<RenameConversation conversationId={c.id} title={c.title} />
									<DeleteConversation
										conversationId={c.id}
										title={c.title}
										onDeleted={() => router.invalidate()}
									/>
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}

function AiSetupGuidance() {
	return (
		<section
			className="mt-6 rounded-md border bg-muted/40 p-4 text-sm"
			aria-labelledby="ai-setup"
		>
			<h2 id="ai-setup" className="font-medium">
				AI is not configured
			</h2>
			<p className="mt-1">
				Conversations need a language model. Set <code>AI_PROVIDER</code>,{" "}
				<code>AI_MODEL</code>, and (for hosted providers){" "}
				<code>AI_API_KEY</code> in the server's environment, then restart
				Marginalia. For a local model, use{" "}
				<code>AI_PROVIDER=openai-compatible</code> with <code>AI_BASE_URL</code>
				. Reading and search work without it. See the deployment guide for
				examples.
			</p>
		</section>
	);
}
