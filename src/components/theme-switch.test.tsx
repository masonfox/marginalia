// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { resetThemeStoreForTests, THEME_STORAGE_KEY } from "#/lib/theme";
import { ThemeSwitch } from "./theme-switch";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let prefersDark = false;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	prefersDark = false;
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			media: query,
			get matches() {
				return prefersDark;
			},
			addEventListener: () => {},
			removeEventListener: () => {},
		})),
	);
	localStorage.clear();
	resetThemeStoreForTests();
	document.documentElement.removeAttribute("data-theme");
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

const render = () => act(() => root.render(<ThemeSwitch />));
const group = () => {
	const el = document.querySelector('[role="group"]');
	if (!el) throw new Error("no theme group");
	return el;
};
const buttons = () => [...group().querySelectorAll("button")];
const pressed = () =>
	buttons()
		.filter((b) => b.getAttribute("aria-pressed") === "true")
		.map((b) => b.getAttribute("aria-label"));

describe("ThemeSwitch", () => {
	it("is a group named Theme of three toggle buttons", () => {
		render();
		expect(group().getAttribute("aria-label")).toBe("Theme");
		expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual([
			"Light theme",
			"Sepia theme",
			"Dark theme",
		]);
		for (const b of buttons()) expect(b.type).toBe("button");
	});

	it("presses the theme the system resolves to when nothing is chosen", () => {
		prefersDark = true;
		render();
		expect(pressed()).toEqual(["Dark theme"]);
	});

	it("presses the stored theme", () => {
		localStorage.setItem(THEME_STORAGE_KEY, "sepia");
		render();
		expect(pressed()).toEqual(["Sepia theme"]);
	});

	it("applies, remembers, and marks a chosen theme", () => {
		render();
		expect(pressed()).toEqual(["Light theme"]);
		const sepia = buttons()[1];
		act(() => sepia?.click());
		expect(document.documentElement.dataset.theme).toBe("sepia");
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("sepia");
		expect(pressed()).toEqual(["Sepia theme"]);
	});
});
