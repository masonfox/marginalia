// Conversations, messages, retrieval tools, citations, and chat orchestration.

export { type CitationMarker, parseCitationMarkers } from "#/lib/citations";
export * from "#/lib/passage-ref";
export * from "#/lib/reply-context";
export {
	type ChatDeps,
	type ChatInput,
	type ChatStart,
	type ChatUIMessage,
	describeError,
	type NewThreadAnchor,
	type SetModelResult,
	setConversationModel,
	startChat,
	THREAD_ID_HEADER,
} from "./chat";
export {
	type GuideStepSummary,
	type GuideStepView,
	getGuideStep,
	getTrailObservations,
	loadBookMaps,
	mapFingerprint,
	type TrailCorrection,
	type TrailObservation,
} from "./guide-context";
export { handleChatRequest } from "./http";
export {
	checkPassageRef,
	type PassageCheck,
	type PassageRefInvalid,
} from "./passage-ref";
export { buildSystemPrompt, PROMPT_VERSION } from "./prompt";
export * from "./repository";
export * from "./schema";
export { projectThreadAnchor, type ThreadAnchor } from "./thread-context";
export {
	cancelTitleBestEffort,
	claimTitle,
	dispatchTitles,
	runTitle,
} from "./title";
export type { NamingPatch } from "./title-metadata";
export { readNamingMetadata } from "./title-metadata";
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
	getThreadWithUsage,
	type ThreadWithUsage,
	usageForThread,
} from "./usage";
export { type VerifyDeps, verifyCitations } from "./verify";
