// Conversations, messages, retrieval tools, citations, and chat orchestration.

export { type CitationMarker, parseCitationMarkers } from "#/lib/citations";
export {
	type ChatDeps,
	type ChatInput,
	type ChatStart,
	type ChatUIMessage,
	describeError,
	startChat,
} from "./chat";
export { handleChatRequest } from "./http";
export { buildSystemPrompt, PROMPT_VERSION } from "./prompt";
export * from "./reply-context";
export * from "./repository";
export * from "./schema";
export {
	bookHandle,
	type ConversationTools,
	createConversationTools,
	getOutline,
	LIMITS,
	readPassage,
	readSection,
	searchBooks,
	type ToolDeps,
} from "./tools";
export {
	type ConversationWithUsage,
	getConversationWithUsage,
} from "./usage";
export { type VerifyDeps, verifyCitations } from "./verify";
