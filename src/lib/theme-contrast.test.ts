import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG contrast for the theme tokens in src/styles.css (design.md §1): every
 * text token must reach 4.5:1 on --background and --card in each theme.
 * Translucent colors are composited over the background they sit on.
 */

const css = readFileSync(
	new URL("../styles.css", import.meta.url),
	"utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

type Tokens = Record<string, string>;

function declarations(body: string): Tokens {
	const tokens: Tokens = {};
	for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		tokens[m[1]] = m[2].trim().replace(/\s+/g, " ");
	}
	return tokens;
}

/** The rule bodies whose selector list includes `selector`. */
function rules(selector: string): Tokens {
	const tokens: Tokens = {};
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selectors = m[1].split(",").map((s) => s.trim());
		if (selectors.includes(selector)) Object.assign(tokens, declarations(m[2]));
	}
	return tokens;
}

const THEMES = ["light", "sepia", "dark"] as const;

/** A theme's tokens as they compute on <html data-theme="…">. */
function themeTokens(theme: (typeof THEMES)[number]): Tokens {
	const raw = {
		...rules(":root"),
		...rules(`[data-theme="${theme}"]`),
	};
	const resolve = (value: string, depth = 0): string =>
		depth > 10
			? value
			: value.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
					resolve(raw[name] ?? "", depth + 1),
				);
	return Object.fromEntries(
		Object.entries(raw).map(([k, v]) => [k, resolve(v)]),
	);
}

type RGBA = [number, number, number, number];

function parseColor(value: string): RGBA {
	const hex = value.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = Number.parseInt(hex[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
	}
	const rgba = value.match(
		/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
	);
	if (rgba) {
		return [
			Number(rgba[1]),
			Number(rgba[2]),
			Number(rgba[3]),
			rgba[4] === undefined ? 1 : Number(rgba[4]),
		];
	}
	throw new Error(`Unsupported color in the contrast test: ${value}`);
}

const over = ([r, g, b, a]: RGBA, [br, bg, bb]: RGBA): RGBA => [
	r * a + br * (1 - a),
	g * a + bg * (1 - a),
	b * a + bb * (1 - a),
	1,
];

function luminance([r, g, b]: RGBA): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(text: string, background: string, page: string) {
	// Translucent surfaces sit on the page; translucent text on its surface.
	const bg = over(parseColor(background), parseColor(page));
	const fg = over(parseColor(text), bg);
	const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
	return (hi + 0.05) / (lo + 0.05);
}

/** Text tokens that appear on the page and on cards. */
const TEXT = [
	"--foreground",
	"--card-foreground",
	"--muted-foreground",
	"--faint-foreground",
	"--amber-foreground",
	"--destructive-foreground",
	"--status-processing",
	"--status-failed",
	"--status-unavailable",
	"--status-not-started",
	"--status-reading",
	"--status-finished",
];

/** Text on its own paired fill. */
const PAIRS: [text: string, background: string][] = [
	["--primary-foreground", "--primary"],
	["--secondary-foreground", "--secondary"],
	["--accent-foreground", "--accent"],
	["--popover-foreground", "--popover"],
];

describe.each(THEMES)("%s theme contrast", (theme) => {
	const t = themeTokens(theme);
	const cases = [
		...TEXT.flatMap((text) =>
			["--background", "--card"].map((bg) => [text, bg] as const),
		),
		...PAIRS,
	];

	it.each(cases)("%s on %s is at least 4.5:1", (text, bg) => {
		expect(t[text], text).toBeDefined();
		expect(t[bg], bg).toBeDefined();
		expect(contrast(t[text], t[bg], t["--background"])).toBeGreaterThanOrEqual(
			4.5,
		);
	});
});

/** Actual tinted surfaces: scope/citations, notes, reader highlights, warnings,
 * destructive controls, badges and footer bands. Test translucent fills over
 * both page and card because these pieces occur in dialogs as well as pages.
 */
const TINTED: [text: string, fill: string, opacity: number][] = [
	["--amber-foreground", "--amber-soft", 1],
	["--amber-foreground", "--amber", 0.25],
	["--foreground", "--amber-soft", 1],
	["--muted-foreground", "--amber-soft", 1],
	["--foreground", "--highlight", 1],
	["--foreground", "--secondary", 1],
	["#1a0f05", "--amber", 1],
	["--background", "--destructive", 1],
	["--status-unavailable", "--status-unavailable", 0.1],
	["--destructive-foreground", "--destructive", 0.1],
	["--muted-foreground", "--secondary", 1],
	["--muted-foreground", "--muted", 0.4],
	["--muted-foreground", "--background-2", 1],
];

describe.each(THEMES)("%s tinted text contrast", (theme) => {
	const t = themeTokens(theme);
	const cases = TINTED.flatMap(([text, fill, opacity]) =>
		["--background", "--card"].map((base) => ({ text, fill, opacity, base })),
	);
	it.each(cases)("$text on $fill at $opacity over $base is at least 4.5:1", ({
		text,
		fill,
		opacity,
		base,
	}) => {
		const color = parseColor(t[fill]);
		color[3] *= opacity;
		const surface = over(color, parseColor(t[base]));
		expect(
			contrast(
				t[text] ?? text,
				`rgb(${surface.slice(0, 3).join(",")})`,
				t[base],
			),
		).toBeGreaterThanOrEqual(4.5);
	});
	it.each([
		"--background",
		"--card",
	])("amber text on nested amber-soft over %s is at least 4.5:1", (base) => {
		// The current Contents row has an amber-soft numbered marker inside it.
		const row = over(parseColor(t["--amber-soft"]), parseColor(t[base]));
		const marker = over(parseColor(t["--amber-soft"]), row);
		expect(
			contrast(
				t["--amber-foreground"],
				`rgb(${marker.slice(0, 3).join(",")})`,
				t[base],
			),
		).toBeGreaterThanOrEqual(4.5);
	});
});

describe("contrast()", () => {
	it("matches the WCAG reference values", () => {
		expect(contrast("#000000", "#ffffff", "#ffffff")).toBeCloseTo(21, 5);
		expect(contrast("#777777", "#ffffff", "#ffffff")).toBeCloseTo(4.48, 2);
	});

	it("composites translucent colors over the page", () => {
		// 50% black over white is rgb(127.5, 127.5, 127.5).
		expect(contrast("rgba(0,0,0,.5)", "#ffffff", "#ffffff")).toBeCloseTo(
			contrast("rgb(127.5,127.5,127.5)", "#ffffff", "#ffffff"),
			5,
		);
	});
});
