/**
 * Display theme: light, sepia, or dark, set as data-theme on <html>.
 *
 * The reader's choice is kept in this browser under THEME_STORAGE_KEY. The
 * default, "system", follows the OS light/dark preference and changes with it;
 * sepia is only ever an explicit choice. THEME_INIT_SCRIPT applies the theme
 * from <head> before first paint; this module keeps it in step afterwards.
 */
import { useEffect, useSyncExternalStore } from "react";

export const THEMES = ["light", "sepia", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export type ThemeChoice = Theme | "system";

export const THEME_STORAGE_KEY = "marginalia:theme";

/** Each theme's --background, for <meta name="theme-color">. */
export const THEME_COLORS: Record<Theme, string> = {
	light: "#faf8f4",
	sepia: "#f2e8d6",
	dark: "#0d0a08",
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

const isTheme = (value: unknown): value is Theme =>
	THEMES.includes(value as Theme);

/** The stored choice; "system" when none is stored or storage is unavailable. */
export function readThemeChoice(): ThemeChoice {
	try {
		const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
		return isTheme(stored) ? stored : "system";
	} catch {
		return "system";
	}
}

function writeThemeChoice(choice: ThemeChoice) {
	try {
		window.localStorage.setItem(THEME_STORAGE_KEY, choice);
	} catch {
		// Storage unavailable: the choice lasts for this page only.
	}
}

export function systemPrefersDark(): boolean {
	return (
		typeof window.matchMedia === "function" &&
		window.matchMedia(DARK_QUERY).matches
	);
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
	if (choice !== "system") return choice;
	return prefersDark ? "dark" : "light";
}

/** Sets data-theme, color-scheme, and the theme-color meta on the document. */
export function applyTheme(theme: Theme, doc: Document = document) {
	const root = doc.documentElement;
	root.dataset.theme = theme;
	root.style.colorScheme = theme === "dark" ? "dark" : "light";
	let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (!meta) {
		meta = doc.createElement("meta");
		meta.name = "theme-color";
		doc.head.append(meta);
	}
	meta.content = THEME_COLORS[theme];
}

/**
 * Runs inline in <head> before the stylesheet paints. Self-contained: it
 * mirrors readThemeChoice, resolveTheme, and applyTheme above.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},c=${JSON.stringify(THEME_COLORS)},t=null;try{t=localStorage.getItem(k)}catch(e){}if(!Object.prototype.hasOwnProperty.call(c,t)){t=window.matchMedia&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light"}var d=document.documentElement;d.setAttribute("data-theme",t);d.style.colorScheme=t==="dark"?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.name="theme-color";document.head.appendChild(m)}m.content=c[t]}catch(e){}})();`;

// A small store so every control showing the theme stays in step, across
// components and across tabs.

let choice: ThemeChoice | null = null;
const listeners = new Set<() => void>();

const currentChoice = () => {
	choice ??= readThemeChoice();
	return choice;
};

const currentTheme = (): Theme => {
	const applied = document.documentElement.dataset.theme;
	return isTheme(applied)
		? applied
		: resolveTheme(currentChoice(), systemPrefersDark());
};

function sync() {
	applyTheme(resolveTheme(currentChoice(), systemPrefersDark()));
	for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
	if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
	choice = readThemeChoice();
	sync();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	if (listeners.size === 1) {
		window.matchMedia?.(DARK_QUERY).addEventListener("change", sync);
		window.addEventListener("storage", onStorage);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			window.matchMedia?.(DARK_QUERY).removeEventListener("change", sync);
			window.removeEventListener("storage", onStorage);
		}
	};
}

/** Chooses a theme ("system" to follow the OS again), remembers it, and applies it. */
export function setThemeChoice(next: ThemeChoice) {
	choice = next;
	writeThemeChoice(next);
	sync();
}

/** The reader's choice; "system" during server rendering. */
export function useThemeChoice(): ThemeChoice {
	return useSyncExternalStore(subscribe, currentChoice, () => "system");
}

/** The theme on screen; null during server rendering, when it is not known yet. */
export function useResolvedTheme(): Theme | null {
	return useSyncExternalStore(subscribe, currentTheme, () => null);
}

/** Keeps the page following the OS preference while the choice is "system". */
export function ThemeSync() {
	useEffect(() => subscribe(() => {}), []);
	return null;
}

/** For tests: forget the cached choice. */
export function resetThemeStoreForTests() {
	choice = null;
}
