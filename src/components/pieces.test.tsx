// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressBar, ScopePill } from "./pieces";

const parse = (html: string) => {
	const doc = new DOMParser().parseFromString(html, "text/html");
	return doc.body.firstElementChild as HTMLElement;
};

describe("ScopePill", () => {
	it("keeps its text as written (uppercase is visual only) with a hidden icon", () => {
		const el = parse(
			renderToStaticMarkup(<ScopePill>Through Chapter 3</ScopePill>),
		);
		expect(el.textContent).toBe("Through Chapter 3");
		expect(el.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("can drop the icon", () => {
		const el = parse(
			renderToStaticMarkup(<ScopePill icon={false}>Your position</ScopePill>),
		);
		expect(el.querySelector("svg")).toBeNull();
	});
});

describe("ProgressBar", () => {
	it("reports the share as a rounded percentage, clamped to 0–100", () => {
		const at = (value: number) =>
			parse(
				renderToStaticMarkup(<ProgressBar value={value} label="Read" />),
			).getAttribute("aria-valuenow");
		expect(at(0.594)).toBe("59");
		expect(at(-1)).toBe("0");
		expect(at(2)).toBe("100");
	});

	it("is a labelled progressbar", () => {
		const el = parse(
			renderToStaticMarkup(<ProgressBar value={0.5} label="Share read" />),
		);
		expect(el.getAttribute("role")).toBe("progressbar");
		expect(el.getAttribute("aria-label")).toBe("Share read");
	});
});
