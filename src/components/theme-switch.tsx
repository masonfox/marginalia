import { cn } from "cn";
import type { ReactNode, SVGProps } from "react";
import {
	setThemeChoice,
	THEMES,
	type Theme,
	useResolvedTheme,
} from "#/lib/theme";

export const THEME_LABELS: Record<Theme, string> = {
	light: "Light",
	sepia: "Sepia",
	dark: "Dark",
};

type IconProps = SVGProps<SVGSVGElement>;

/** The mockups' theme glyphs: decorative, as their buttons carry the names. */
const GLYPHS: Record<Theme, ReactNode> = {
	light: (
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
		</>
	),
	sepia: (
		<path d="M2.5 4.5h6a3.5 3.5 0 0 1 3.5 3.5v12a3 3 0 0 0-3-3H2.5zM21.5 4.5h-6A3.5 3.5 0 0 0 12 8v12a3 3 0 0 1 3-3h6.5z" />
	),
	dark: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
};

/** Sun for light, an open book for sepia, a moon for dark. */
export function ThemeIcon({ theme, ...props }: IconProps & { theme: Theme }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			{...props}
			aria-hidden="true"
		>
			{GLYPHS[theme]}
		</svg>
	);
}

/**
 * The header's theme control: three toggle buttons, the one on screen
 * pressed. Choosing one remembers it in this browser; "Match my system" in
 * Settings follows the OS again. Before hydration none is pressed, as the
 * theme is only known in the browser.
 */
export function ThemeSwitch({ className }: { className?: string }) {
	const current = useResolvedTheme();
	return (
		// biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset
		<div
			role="group"
			aria-label="Theme"
			className={cn(
				"inline-flex shrink-0 gap-0.5 rounded-full border border-border bg-secondary p-[3px]",
				className,
			)}
		>
			{THEMES.map((theme) => (
				<button
					key={theme}
					type="button"
					aria-pressed={current === theme}
					aria-label={`${THEME_LABELS[theme]} theme`}
					onClick={() => setThemeChoice(theme)}
					className="grid size-[34px] cursor-pointer place-items-center rounded-full text-faint-foreground outline-none transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring aria-pressed:bg-card aria-pressed:text-amber-foreground aria-pressed:shadow-[0_1px_3px_rgba(0,0,0,.18)]"
				>
					<ThemeIcon theme={theme} className="size-4" />
				</button>
			))}
		</div>
	);
}
