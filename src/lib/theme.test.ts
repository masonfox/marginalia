// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyTheme,
	readThemeChoice,
	resetThemeStoreForTests,
	resolveTheme,
	setThemeChoice,
	THEME_COLORS,
	THEME_INIT_SCRIPT,
	THEME_STORAGE_KEY,
} from "./theme";

let prefersDark = false;
const changeListeners = new Set<() => void>();

beforeEach(() => {
	prefersDark = false;
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			media: query,
			get matches() {
				return prefersDark;
			},
			addEventListener: (_: string, l: () => void) => changeListeners.add(l),
			removeEventListener: (_: string, l: () => void) =>
				changeListeners.delete(l),
		})),
	);
	localStorage.clear();
	resetThemeStoreForTests();
	document.documentElement.removeAttribute("data-theme");
	document.documentElement.removeAttribute("style");
	document.head.replaceChildren();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const html = () => document.documentElement;
const themeColor = () =>
	document.querySelector('meta[name="theme-color"]')?.getAttribute("content");

describe("resolveTheme", () => {
	it("follows the system only for the system choice", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
		expect(resolveTheme("sepia", true)).toBe("sepia");
		expect(resolveTheme("light", true)).toBe("light");
	});
});

describe("readThemeChoice", () => {
	it("defaults to system", () => {
		expect(readThemeChoice()).toBe("system");
	});

	it("ignores unknown stored values", () => {
		localStorage.setItem(THEME_STORAGE_KEY, "solarized");
		expect(readThemeChoice()).toBe("system");
	});

	it("falls back to system when storage throws", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(readThemeChoice()).toBe("system");
	});
});

describe("applyTheme", () => {
	it("sets data-theme, color-scheme, and theme-color", () => {
		applyTheme("sepia");
		expect(html().dataset.theme).toBe("sepia");
		expect(html().style.colorScheme).toBe("light");
		expect(themeColor()).toBe(THEME_COLORS.sepia);
		applyTheme("dark");
		expect(html().style.colorScheme).toBe("dark");
		expect(themeColor()).toBe(THEME_COLORS.dark);
		expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(
			1,
		);
	});
});

describe("setThemeChoice", () => {
	it("remembers and applies the choice", () => {
		setThemeChoice("sepia");
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("sepia");
		expect(html().dataset.theme).toBe("sepia");
		prefersDark = true;
		setThemeChoice("system");
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
		expect(html().dataset.theme).toBe("dark");
	});

	it("still applies when storage throws", () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		setThemeChoice("dark");
		expect(html().dataset.theme).toBe("dark");
	});
});

describe("THEME_INIT_SCRIPT", () => {
	const run = () => new Function(THEME_INIT_SCRIPT)();

	it("applies a stored theme", () => {
		localStorage.setItem(THEME_STORAGE_KEY, "sepia");
		prefersDark = true;
		run();
		expect(html().dataset.theme).toBe("sepia");
		expect(html().style.colorScheme).toBe("light");
		expect(themeColor()).toBe(THEME_COLORS.sepia);
	});

	it.each([
		[true, "dark"],
		[false, "light"],
	])("follows the system (dark: %s) when nothing or system is stored", (dark, theme) => {
		prefersDark = dark;
		run();
		expect(html().dataset.theme).toBe(theme);
		localStorage.setItem(THEME_STORAGE_KEY, "system");
		run();
		expect(html().dataset.theme).toBe(theme);
	});

	it("falls back to the system when storage throws", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		prefersDark = true;
		run();
		expect(html().dataset.theme).toBe("dark");
	});
});
