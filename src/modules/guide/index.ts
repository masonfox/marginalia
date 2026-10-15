// The reader layer over the machine guide: reader-owned data and the merged,
// bounded view the Guide, margin glosses and the assistant all read.

export {
	type CitationInput,
	type CorrectionInput,
	type CorrectionResult,
	keepCorrection,
	removeCorrection,
	saveCorrection,
} from "./correction-edits";
export {
	type CorrectionRecord,
	fingerprintOf,
	listCorrections,
	MAX_CITATION_QUOTE,
	MAX_CORRECTION_TEXT,
	observationText,
} from "./corrections";
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
	type CorrectionMark,
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
	type MergeOptions,
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
	type CorrectionReview,
	type DetachedCorrection,
	type GuideBoundChoice,
	type GuideChapter,
	type GuideOverview,
	type GuideProvenance,
	type GuideResult,
	getCorrectionReview,
	getGuideChapters,
	getGuideOverview,
	getGuideProvenance,
	getGuideSubject,
	listGuideProposals,
	listGuideSubjects,
	type RegeneratedCorrection,
} from "./view";
