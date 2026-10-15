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
	listSubjects,
	resolveNames,
	type SubjectResolution,
	type SubjectTimeline,
	type TimelineEntry,
	type UnitAnchors,
	type UnitRowKey,
	unitAnchorsCache,
} from "./queries";
export * from "./schema";
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
	listGuideSubjects,
} from "./view";
