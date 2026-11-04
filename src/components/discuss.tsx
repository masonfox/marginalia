import { BookComposer } from "#/components/book-composer";
import { ConversationList } from "#/components/conversation-list";
import type { ConversationSummary } from "#/modules/conversation";
import type { AiStatus } from "#/modules/settings";

/**
 * The Discuss tab: the composer for a new conversation (or why none can be
 * started), then the book's conversations. The list shows either way.
 */
export function DiscussView({
	editionId,
	isReady,
	status,
	conversations,
}: {
	editionId: string;
	isReady: boolean;
	status: AiStatus;
	conversations: ConversationSummary[];
}) {
	return (
		<div className="space-y-8">
			{isReady ? (
				<BookComposer editionId={editionId} status={status} />
			) : (
				<p
					className="text-sm text-muted-foreground"
					data-testid="discuss-not-ready"
				>
					Conversations are available once the book has finished importing.
				</p>
			)}
			<ConversationList conversations={conversations} />
		</div>
	);
}
