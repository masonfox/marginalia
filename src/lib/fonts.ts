/**
 * Self-hosted typefaces (Latin subset only), bundled from @fontsource so no
 * request leaves the instance for fonts. The @font-face rules are rendered in
 * <head> next to the preloads so both use the same bundled URLs.
 *
 * - Display: Cormorant Garamond 500/600 (titles, section headings)
 * - Interface: Instrument Sans, variable weight (controls, assistant prose)
 * - Reading: Newsreader, variable weight and optical size, roman and italic
 *   (the book's own words)
 */
import cormorant500 from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2?url";
import cormorant600 from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2?url";
import instrumentSans from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url";
import newsreaderItalic from "@fontsource-variable/newsreader/files/newsreader-latin-opsz-italic.woff2?url";
import newsreader from "@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2?url";

/** The Latin subset's characters, as published by Fontsource. */
const LATIN =
	"U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

interface Face {
	family: string;
	src: string;
	weight: string;
	style?: "normal" | "italic";
	/** Variable fonts declare woff2-variations. */
	variable?: boolean;
}

const FACES: Face[] = [
	{ family: "Cormorant Garamond", src: cormorant500, weight: "500" },
	{ family: "Cormorant Garamond", src: cormorant600, weight: "600" },
	{
		family: "Instrument Sans",
		src: instrumentSans,
		weight: "400 700",
		variable: true,
	},
	{ family: "Newsreader", src: newsreader, weight: "200 800", variable: true },
	{
		family: "Newsreader",
		src: newsreaderItalic,
		weight: "200 800",
		style: "italic",
		variable: true,
	},
];

export const fontFaceCss = FACES.map(
	(f) =>
		`@font-face{font-family:"${f.family}";font-style:${f.style ?? "normal"};font-weight:${f.weight};font-display:swap;src:url(${JSON.stringify(f.src)}) format("${f.variable ? "woff2-variations" : "woff2"}");unicode-range:${LATIN}}`,
).join("\n");

/** Only the faces the first paint needs: interface 400/600 (one variable file) and display 600. */
export const fontPreloads = [instrumentSans, cormorant600].map((href) => ({
	rel: "preload",
	href,
	as: "font",
	type: "font/woff2",
	crossOrigin: "anonymous" as const,
}));
