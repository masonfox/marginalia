// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyTheme,
	readSystemLightTheme,
	readThemeChoice,
	resetThemeStoreForTests,
	resolveTheme,
	SYSTEM_LIGHT_THEME_STORAGE_KEY,
	setSystemLightTheme,
	setThemeChoice,
	THEME_COLORS,
	THEME_INIT_SCRIPT,
	THEME_STORAGE_KEY,
	type ThemeChoice,
	useSystemLightTheme,
	useThemeChoice,
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

describe("system light preference", () => {
	it.each([
		null,
		"invalid",
		"dark",
		"light",
		"sepia",
	])("validates stored %s", (value) => {
		if (value !== null)
			localStorage.setItem(SYSTEM_LIGHT_THEME_STORAGE_KEY, value);
		expect(readSystemLightTheme()).toBe(value === "sepia" ? "sepia" : "light");
	});
	it("guards reads and preserves session changes when writes are blocked", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw Error("blocked");
		});
		expect(readSystemLightTheme()).toBe("light");
		setSystemLightTheme("sepia");
		expect(html().dataset.theme).toBe("sepia");
		setThemeChoice("dark");
		setThemeChoice("system");
		expect(html().dataset.theme).toBe("sepia");
	});
	it("syncs each key independently across tabs and resets both on storage clear", () => {
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const container = document.createElement("div");
		const root = createRoot(container);
		function Observer() {
			return createElement(
				"span",
				null,
				`${useThemeChoice()}:${useSystemLightTheme()}`,
			);
		}
		act(() => root.render(createElement(Observer)));
		const storage = (key: string | null) =>
			act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
		try {
			localStorage.setItem(SYSTEM_LIGHT_THEME_STORAGE_KEY, "sepia");
			storage(SYSTEM_LIGHT_THEME_STORAGE_KEY);
			expect(container.textContent).toBe("system:sepia");
			expect(html().dataset.theme).toBe("sepia");
			localStorage.setItem(THEME_STORAGE_KEY, "dark");
			storage(THEME_STORAGE_KEY);
			expect(container.textContent).toBe("dark:sepia");
			localStorage.removeItem(SYSTEM_LIGHT_THEME_STORAGE_KEY);
			storage(SYSTEM_LIGHT_THEME_STORAGE_KEY);
			expect(container.textContent).toBe("dark:light");
			act(() => setSystemLightTheme("sepia"));
			expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
			localStorage.clear();
			storage(null);
			expect(container.textContent).toBe("system:light");
			expect(html().dataset.theme).toBe("light");
		} finally {
			act(() => root.unmount());
		}
	});
	it("resets the cached preference", () => {
		setSystemLightTheme("sepia");
		localStorage.clear();
		resetThemeStoreForTests();
		setThemeChoice("system");
		expect(html().dataset.theme).toBe("light");
	});
});

for (const choice of ["light", "sepia", "dark", "system"] as ThemeChoice[]) {
	for (const dark of [false, true]) {
		for (const light of ["light", "sepia"] as const) {
			it(`matches runtime and head metadata for ${choice}/${dark}/${light}`, () => {
				prefersDark = dark;
				localStorage.setItem(THEME_STORAGE_KEY, choice);
				localStorage.setItem(SYSTEM_LIGHT_THEME_STORAGE_KEY, light);
				const expected = choice === "system" ? (dark ? "dark" : light) : choice;
				expect(resolveTheme(choice, dark, light)).toBe(expected);
				new Function(THEME_INIT_SCRIPT)();
				expect(html().dataset.theme).toBe(expected);
				expect(html().style.colorScheme).toBe(
					expected === "dark" ? "dark" : "light",
				);
				expect(themeColor()).toBe(THEME_COLORS[expected]);
				setThemeChoice(choice);
				expect(html().dataset.theme).toBe(expected);
				expect(themeColor()).toBe(THEME_COLORS[expected]);
			});
		}
	}
}
