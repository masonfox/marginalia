// The reader layer over the machine guide: reader-owned data and the merged,
// bounded view the Guide, margin glosses and the assistant all read.

export {
	clearReadingPosition,
	getReadingPosition,
	type PositionChoice,
	type ReadingPosition,
	rebaseReadingPositions,
	type SetPositionResult,
	setReadingPosition,
} from "./position";
export {
	dominantKind,
	type GuideObservation,
	type GuideSubjectEntry,
	type GuideSummary,
	getMergedObservations,
	getMergedSummaries,
	getSubjectTimeline,
	getUnitAnchors,
	listProposals,
	listSubjects,
	loadSubjectLinks,
	resolveSubjects,
	type SubjectTimeline,
	type TimelineEntry,
	type UnitAnchors,
	type UnitRowKey,
	unitAnchorsCache,
} from "./queries";
export { END_OF_BOOK_POSITION, reanchor } from "./reanchor";
export * from "./schema";
export {
	dismissProposal,
	mergeSubjects,
	type RevealChoice,
	removeAlias,
	renameSubject,
	type SubjectEditResult,
	setSubjectKind,
	splitSubject,
} from "./subject-edits";
export {
	type AliasLink,
	type Appearance,
	buildResolution,
	implicitRef,
	MAX_PROPOSALS,
	type MergeProposal,
	parseRef,
	proposeMerges,
	type SubjectName,
	type SubjectRecord,
	type SubjectResolution,
	significantTokens,
	subjectRef,
} from "./subjects";
export {
	type GuideBoundChoice,
	type GuideChapter,
	type GuideOverview,
	type GuideProvenance,
	type GuideResult,
	getGuideChapters,
	getGuideOverview,
	getGuideProvenance,
	getGuideSubject,
	listGuideProposals,
	listGuideSubjects,
} from "./view";
