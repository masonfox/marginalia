import { Link, type LinkProps } from "@tanstack/react-router";
import { cn } from "cn";
import { Menu } from "lucide-react";
import { useRef } from "react";
import { THEME_LABELS, ThemeIcon } from "#/components/theme-switch";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	setThemeChoice,
	THEMES,
	type Theme,
	useResolvedTheme,
} from "#/lib/theme";

/**
 * The header's navigation entries, shared by the inline navigation and the
 * phone menu so the two cannot drift. Dashboard is current only on the site
 * root; Library and Conversations whatever their search, so a filtered
 * Library still marks Library. The links carry no search: going back
 * restores a filtered library, as its URL holds the search and filter.
 */
export const NAV_ENTRIES = [
	{
		to: "/",
		label: "Dashboard",
		activeOptions: { exact: true, includeSearch: false },
	},
	{
		to: "/library",
		label: "Library",
		activeOptions: { includeSearch: false },
	},
	{
		to: "/conversations",
		label: "Conversations",
		activeOptions: { includeSearch: false },
	},
] as const satisfies readonly {
	to: LinkProps["to"];
	label: string;
	activeOptions: LinkProps["activeOptions"];
}[];

/** The current entry, from the router's `aria-current="page"`: a filled pill. */
const CURRENT =
	"aria-[current=page]:bg-secondary aria-[current=page]:font-medium aria-[current=page]:text-foreground";

/** The mockups' nav links: 14px/500, muted, with a pill for the current page. */
const ENTRY = cn(
	"inline-flex shrink-0 items-center rounded-lg px-3 py-[11px] text-sm leading-none font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring pointer-coarse:min-h-11",
	CURRENT,
);

/** Touch-sized menu items; the current entry keeps the pill. */
const MENU_ITEM = cn("min-h-11 px-3 text-base", CURRENT);

/** Touch-sized theme options; the one on screen is checked. */
const THEME_ITEM =
	"min-h-11 text-base data-[state=checked]:font-medium data-[state=checked]:text-foreground";

/**
 * The app header's switch between the dashboard, the library, and the
 * conversations page. On other pages no entry is current. Shown from sm up;
 * below sm the same entries are in `HeaderMenu`.
 */
export function HomeNav({ className }: { className?: string }) {
	return (
		<nav
			aria-label="Main"
			className={cn("flex gap-0.5", className)}
			data-testid="home-nav"
		>
			{NAV_ENTRIES.map((entry) => (
				<Link
					key={entry.to}
					to={entry.to}
					activeOptions={entry.activeOptions}
					className={ENTRY}
				>
					{entry.label}
				</Link>
			))}
		</nav>
	);
}

/**
 * The phone menu's theme options, standing in for the header's theme switch.
 * The group's name states the theme on screen; choosing one remembers it.
 */
function ThemeMenuOptions() {
	const current = useResolvedTheme();
	return (
		<>
			<DropdownMenuLabel>Theme</DropdownMenuLabel>
			<DropdownMenuRadioGroup
				aria-label={current ? `Theme: ${THEME_LABELS[current]}` : "Theme"}
				value={current ?? ""}
				onValueChange={(value) => setThemeChoice(value as Theme)}
			>
				{THEMES.map((theme) => (
					<DropdownMenuRadioItem
						key={theme}
						value={theme}
						className={THEME_ITEM}
					>
						<ThemeIcon theme={theme} />
						{THEME_LABELS[theme]}
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		</>
	);
}

/**
 * The phone header's menu: the navigation entries, the theme options, then
 * Settings and, when a password is set, Log out. Log out submits a hidden
 * form, so it stays a POST to `/logout` as on wider viewports.
 */
export function HeaderMenu({
	authEnabled,
	className,
}: {
	authEnabled: boolean;
	className?: string;
}) {
	const logout = useRef<HTMLFormElement>(null);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						aria-label="Menu"
						className={cn("size-11 px-0", className)}
					>
						<Menu aria-hidden className="size-5" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="min-w-48"
					data-testid="header-menu"
				>
					{NAV_ENTRIES.map((entry) => (
						<DropdownMenuItem key={entry.to} asChild className={MENU_ITEM}>
							<Link to={entry.to} activeOptions={entry.activeOptions}>
								{entry.label}
							</Link>
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<ThemeMenuOptions />
					<DropdownMenuSeparator />
					<DropdownMenuItem asChild className={MENU_ITEM}>
						<Link to="/settings">Settings</Link>
					</DropdownMenuItem>
					{authEnabled && (
						<DropdownMenuItem
							className={MENU_ITEM}
							onSelect={() => logout.current?.requestSubmit()}
						>
							Log out
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{authEnabled && (
				<form ref={logout} method="post" action="/logout" hidden />
			)}
		</>
	);
}
