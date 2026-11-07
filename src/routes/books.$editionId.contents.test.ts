import { describe, expect, it } from "vitest";
import type { TocNode } from "#/modules/catalog";
import { tocState } from "./books.$editionId.contents";

const node: TocNode = {
	label: "Chapter",
	locator: "chapter",
	revealPosition: 10,
	children: [],
};

describe("Contents reading states", () => {
	it("leaves an unset position neutral", () => {
		expect(tocState(node, null)).toBe("unset");
	});
	it("marks only the saved unit's locator as the current position", () => {
		expect(
			tocState(
				node,
				{ kind: "unit", scopeLabel: "Chapter", maxPosition: 19 },
				"chapter",
			),
		).toBe("current");
		expect(
			tocState(
				node,
				{ kind: "unit", scopeLabel: "Chapter", maxPosition: 19 },
				"other",
			),
		).toBe("read");
	});
	it("distinguishes read and later targets without disabling navigation", () => {
		expect(
			tocState(node, { kind: "unit", scopeLabel: "Chapter", maxPosition: 9 }),
		).toBe("later");
		expect(
			tocState(node, { kind: "unit", scopeLabel: "Chapter", maxPosition: 10 }),
		).toBe("read");
		expect(tocState(node, { kind: "finished" })).toBe("read");
	});
	it("does not imply that a structural heading has been read", () => {
		expect(
			tocState(
				{ ...node, locator: null, revealPosition: null },
				{ kind: "finished" },
			),
		).toBe("unset");
	});
});
