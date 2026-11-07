import { describe, expect, it } from "vitest";
import type { ReadingPosition } from "#/modules/guide";
import { offersPositionUpdate } from "./conversation-controls";
import { isMoveBack, nextUnit, positionText } from "./reading-position";

const at = (maxPosition: number): ReadingPosition => ({
	kind: "unit",
	maxPosition,
	scopeLabel: `Chapter ${maxPosition}`,
});

describe("positionText", () => {
	it("reads Not set, Finished, or the unit label", () => {
		expect(positionText(null)).toBe("Not set");
		expect(positionText({ kind: "finished" })).toBe("Finished");
		expect(positionText(at(12))).toBe("Chapter 12");
	});
});

describe("isMoveBack", () => {
	it("needs confirmation only for an earlier unit", () => {
		expect(isMoveBack(null, "unit:3")).toBe(false);
		expect(isMoveBack(at(15), "unit:20")).toBe(false);
		expect(isMoveBack(at(15), "unit:15")).toBe(false);
		expect(isMoveBack(at(15), "whole")).toBe(false);
		expect(isMoveBack(at(15), "unit:3")).toBe(true);
		expect(isMoveBack({ kind: "finished" }, "unit:40")).toBe(true);
		expect(isMoveBack({ kind: "finished" }, "whole")).toBe(false);
	});
});

describe("offersPositionUpdate", () => {
	it("offers after widening past the position, or while it is unset", () => {
		expect(offersPositionUpdate(null, { kind: "unit", endPosition: 5 })).toBe(
			true,
		);
		expect(
			offersPositionUpdate(at(12), { kind: "unit", endPosition: 18 }),
		).toBe(true);
		expect(offersPositionUpdate(at(12), { kind: "whole" })).toBe(true);
	});

	it("makes no offer when widening within the position", () => {
		expect(
			offersPositionUpdate(at(20), { kind: "unit", endPosition: 15 }),
		).toBe(false);
		expect(
			offersPositionUpdate(at(20), { kind: "unit", endPosition: 20 }),
		).toBe(false);
		expect(offersPositionUpdate({ kind: "finished" }, { kind: "whole" })).toBe(
			false,
		);
	});
});

describe("nextUnit", () => {
	const unit = (ordinal: number, endPosition: number) => ({
		ordinal,
		label: `Chapter ${ordinal + 1}`,
		path: [`Chapter ${ordinal + 1}`],
		startPosition: endPosition - 9,
		endPosition,
		startLocator: `p${endPosition - 9}`,
	});
	const units = [unit(0, 10), unit(1, 20), unit(2, 30)];

	it("continues after the position's unit, or from the start when unset", () => {
		expect(nextUnit(null, units)?.startLocator).toBe("p1");
		expect(nextUnit(at(10), units)?.startLocator).toBe("p11");
		expect(nextUnit(at(20), units)?.startLocator).toBe("p21");
	});

	it("offers nothing once the book is read or the unit is unknown", () => {
		expect(nextUnit(at(30), units)).toBeUndefined();
		expect(nextUnit({ kind: "finished" }, units)).toBeUndefined();
		expect(nextUnit(at(15), units)).toBeUndefined();
		expect(nextUnit(null, [])).toBeUndefined();
		expect(nextUnit(null, undefined)).toBeUndefined();
	});
});
