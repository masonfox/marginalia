import { describe, expect, it } from "vitest";
import type { ReadingPosition } from "#/modules/guide";
import { offersPositionUpdate } from "./conversation-controls";
import { isMoveBack, positionText } from "./reading-position";

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
