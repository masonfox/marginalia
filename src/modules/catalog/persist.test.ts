import { describe, expect, it } from "vitest";
import { type LocatorMatch, matchLocators } from "./matching";
import { buildForward } from "./persist";

const para = (topic: string) =>
	`The ${topic} was described at length by the narrator, who spared no detail of its long history.`;

/** Text sharing no words with any other topic's. */
const distinct = (topic: string) =>
	["alpha", "beta", "gamma", "delta", "epsilon"]
		.map((w) => `${topic}${w}`)
		.join(" ");

/** Passages of one parser version, with reveal positions in reading order. */
const v = (version: number, texts: string[]) =>
	texts.map((text, i) => ({
		locator: `abc:v${version}:${i}`,
		text,
		revealPosition: i + 1,
	}));

function forwardOf(
	old: { locator: string; text: string }[],
	now: ReturnType<typeof v>,
) {
	return buildForward(old, matchLocators(old, now), now);
}

describe("buildForward", () => {
	it("follows an exact match to its new locator and position", () => {
		const old = v(1, [para("house"), para("garden"), para("river")]);
		const now = v(2, [
			para("preface"),
			para("house"),
			para("garden"),
			para("river"),
		]);
		const forward = forwardOf(old, now);
		expect(forward("abc:v1:0")).toEqual({ locator: "abc:v2:1", position: 2 });
		expect(forward("abc:v1:2")).toEqual({ locator: "abc:v2:3", position: 4 });
	});

	it("follows a moved passage to wherever its text now is", () => {
		const old = v(1, ["a", "b", "c", "d"]);
		const now = v(2, ["a", "c", "d", "b"]);
		const matches = new Map<string, LocatorMatch>([
			["abc:v1:0", { target: "abc:v2:0", kind: "exact" }],
			["abc:v1:1", { target: "abc:v2:3", kind: "merged" }],
			["abc:v1:2", { target: "abc:v2:1", kind: "exact" }],
			["abc:v1:3", { target: "abc:v2:2", kind: "exact" }],
		]);
		const forward = buildForward(old, matches, now);
		expect(forward("abc:v1:1")).toEqual({ locator: "abc:v2:3", position: 4 });
		expect(forward("abc:v1:2")).toEqual({ locator: "abc:v2:1", position: 2 });
	});

	it("points merged passages at the passage holding both texts", () => {
		const old = v(1, [
			para("house"),
			para("garden"),
			para("river"),
			para("hill"),
		]);
		const now = v(2, [
			para("house"),
			`${para("garden")} ${para("river")}`,
			para("hill"),
		]);
		const forward = forwardOf(old, now);
		expect(forward("abc:v1:1")).toEqual({ locator: "abc:v2:1", position: 2 });
		expect(forward("abc:v1:2")).toEqual({ locator: "abc:v2:1", position: 2 });
		expect(forward("abc:v1:3")).toEqual({ locator: "abc:v2:2", position: 3 });
	});

	it("moves a split passage's anchor to its last piece", () => {
		const first = "It was the best of times, it was the worst of times.";
		const second = "It was the age of wisdom, it was the age of foolishness.";
		const old = v(1, [para("intro"), `${first} ${second}`, para("outro")]);
		const now = v(2, [para("intro"), first, second, para("outro")]);
		const matches = matchLocators(old, now);
		expect(matches.get("abc:v1:1")).toEqual({
			target: "abc:v2:1",
			kind: "split",
		});
		const forward = buildForward(old, matches, now);
		expect(forward("abc:v1:1")).toEqual({ locator: "abc:v2:2", position: 3 });
	});

	it("moves a removed passage's anchor to the next surviving passage", () => {
		const old = v(1, [
			para("house"),
			para("garden"),
			para("river"),
			para("hill"),
		]);
		const now = v(2, [para("house"), para("hill")]);
		const forward = forwardOf(old, now);
		expect(forward("abc:v1:1")).toEqual({ locator: "abc:v2:1", position: 2 });
		expect(forward("abc:v1:2")).toEqual({ locator: "abc:v2:1", position: 2 });
	});

	it("returns null when nothing after a removed passage survives, or for unknown locators", () => {
		const old = v(1, [para("house"), para("garden")]);
		const now = v(2, [para("house")]);
		const forward = forwardOf(old, now);
		expect(forward("abc:v1:1")).toBeNull();
		expect(forward("abc:v1:9")).toBeNull();
	});

	it("carries the new passage's reveal position, not its index", () => {
		const old = v(1, [para("house"), para("note")]);
		const now = [
			{ locator: "abc:v2:0", text: para("house"), revealPosition: 1 },
			{ locator: "abc:v2:1", text: para("note"), revealPosition: 1 },
		];
		expect(forwardOf(old, now)("abc:v1:1")).toEqual({
			locator: "abc:v2:1",
			position: 1,
		});
	});

	it("never moves an anchor earlier than the text it covered", () => {
		let seed = 7;
		const random = () => {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			return seed / 2 ** 31;
		};
		for (let round = 0; round < 40; round++) {
			const topics = Array.from({ length: 12 }, (_, i) => `topic${round}x${i}`);
			const old = v(1, topics.map(distinct));
			// Order-preserving edits: insert, remove, merge with the next.
			const texts: { text: string; from: number[] }[] = [];
			for (let i = 0; i < topics.length; i++) {
				const roll = random();
				const text = distinct(topics[i] as string);
				if (roll < 0.15)
					texts.push({ text: distinct(`new${round}x${i}`), from: [] });
				if (roll >= 0.15 && roll < 0.3) continue;
				if (roll >= 0.3 && roll < 0.4 && i + 1 < topics.length) {
					texts.push({
						text: `${text} ${distinct(topics[i + 1] as string)}`,
						from: [i, i + 1],
					});
					i++;
					continue;
				}
				texts.push({ text, from: [i] });
			}
			const now = v(
				2,
				texts.map((t) => t.text),
			);
			const forward = forwardOf(old, now);
			// The latest new position holding text from old passages up to each one.
			let covered = 0;
			for (let i = 0; i < old.length; i++) {
				const holder = texts.findIndex((t) => t.from.includes(i));
				if (holder >= 0) covered = Math.max(covered, holder + 1);
				const anchor = forward(`abc:v1:${i}`);
				if (anchor === null) {
					expect(texts.some((t) => t.from.some((j) => j > i))).toBe(false);
					continue;
				}
				expect(anchor.position).toBeGreaterThanOrEqual(covered);
				// A removed passage's anchor lands past everything before it.
				if (holder < 0) expect(anchor.position).toBeGreaterThan(covered);
			}
		}
	});
});
