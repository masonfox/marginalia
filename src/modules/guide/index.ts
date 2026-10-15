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
	getUnitAnchors,
	type UnitAnchors,
	type UnitRowKey,
	unitAnchorsCache,
} from "./queries";
export * from "./schema";
