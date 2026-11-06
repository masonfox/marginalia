import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { LogOut, SlidersHorizontal } from "lucide-react";
import { HeaderMenu, HomeNav } from "#/components/home-nav";
import { NewConversation } from "#/components/new-conversation";
import { ThemeSwitch } from "#/components/theme-switch";
import { Button } from "#/components/ui/button";
import { getShellInfo } from "#/fns/library";
import { fontFaceCss, fontPreloads } from "#/lib/fonts";
import { THEME_INIT_SCRIPT, ThemeSync } from "#/lib/theme";
import appCss from "../styles.css?url";

interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				// Resize the page for the on-screen keyboard, so the docked composer stays above it.
				content:
					"width=device-width, initial-scale=1, interactive-widget=resizes-content",
			},
			{ title: "Marginalia" },
		],
		links: [
			...fontPreloads,
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.ico?v=3", sizes: "16x16 32x32 48x48" },
			{
				rel: "icon",
				type: "image/png",
				sizes: "16x16",
				href: "/assets/brand/icon-16.png?v=3",
			},
			{
				rel: "icon",
				type: "image/png",
				sizes: "32x32",
				href: "/assets/brand/icon-32.png?v=3",
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				sizes: "any",
				href: "/assets/brand/logo-mark.svg?v=3",
			},
			{
				rel: "apple-touch-icon",
				sizes: "180x180",
				href: "/assets/brand/icon-180.png?v=3",
			},
			{ rel: "manifest", href: "/assets/brand/site.webmanifest?v=3" },
		],
	}),
	loader: () => getShellInfo(),
	staleTime: Number.POSITIVE_INFINITY,
	shellComponent: RootDocument,
	component: AppShell,
	notFoundComponent: () => (
		<main className="mx-auto max-w-3xl px-4 py-10">
			<h1 className="font-serif text-2xl font-semibold">Not found</h1>
			<p className="mt-2 text-muted-foreground">
				There is nothing here.{" "}
				<Link to="/" className="underline">
					Back to the dashboard
				</Link>
				.
			</p>
		</main>
	),
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		// The head script sets data-theme and color-scheme before hydration.
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Runs before first paint, so the stored theme shows from the first frame. */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script from #/lib/theme */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: fixed @font-face rules from #/lib/fonts */}
				<style dangerouslySetInnerHTML={{ __html: fontFaceCss }} />
				<HeadContent />
			</head>
			<body>
				<ThemeSync />
				{children}
				<Scripts />
			</body>
		</html>
	);
}

const UNPROTECTED_NOTICE =
	"No password set: anyone who can reach this instance can use it.";

/** The logo mark: an amber page with a ruled margin. */
function LogoMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.7}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect x="3.5" y="2.5" width="17" height="19" rx="2.5" />
			<path d="M8.5 2.5v19" />
			<path d="M11.5 8h5.5M11.5 12h5.5M11.5 16h3.5" />
			<path d="M5.6 9.5h.8M5.6 13.5h.8" />
		</svg>
	);
}

function AppShell() {
	const shell = Route.useLoaderData();
	const onLogin = useRouterState({
		select: (s) => s.location.pathname === "/login",
	});
	if (onLogin) return <Outlet />;
	return (
		<div className="min-h-screen">
			<header className="border-b">
				{/* One row at every width. */}
				<div className="mx-auto flex max-w-[1240px] items-center gap-2 py-2.5 pr-2 pl-4 sm:gap-4 sm:px-6 sm:py-3.5 lg:gap-7 lg:px-8">
					<Link
						to="/"
						className="flex shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring max-sm:mr-auto"
					>
						<LogoMark className="size-6 text-amber sm:size-[26px]" />
						{/* Between sm and md the mark stands alone, leaving room for the navigation. */}
						<span className="font-serif text-[25px] leading-[1.02] font-semibold tracking-[-0.015em] sm:max-md:sr-only md:text-[27px]">
							Marginalia
						</span>
					</Link>
					{/* Below sm the navigation, theme, Settings, and Log out are in the menu. */}
					{!onLogin && <HomeNav className="max-sm:hidden" />}
					{!onLogin && (
						<div className="flex items-center gap-1 sm:ml-auto sm:gap-2.5">
							<ThemeSwitch className="max-sm:hidden" />
							<NewConversation />
							<Button
								asChild
								variant="ghost"
								size="icon"
								className="max-sm:hidden"
							>
								<Link to="/settings" aria-label="Settings">
									<SlidersHorizontal aria-hidden />
								</Link>
							</Button>
							{shell.authEnabled && (
								<form method="post" action="/logout" className="max-sm:hidden">
									<Button
										type="submit"
										variant="ghost"
										aria-label="Log out"
										className="max-lg:size-10 max-lg:px-0"
									>
										<LogOut aria-hidden className="lg:hidden" />
										<span className="max-lg:sr-only">Log out</span>
									</Button>
								</form>
							)}
							<HeaderMenu
								authEnabled={shell.authEnabled}
								className="sm:hidden"
							/>
						</div>
					)}
				</div>
				{!shell.authEnabled && (
					<output
						className="flex items-center justify-center gap-2.5 border-t bg-background-2 px-4 py-[9px] text-center text-xs leading-[1.3] font-medium text-muted-foreground sm:text-[12.5px]"
						title={UNPROTECTED_NOTICE}
						data-testid="unprotected-notice"
					>
						<span
							aria-hidden
							className="size-1.5 shrink-0 rounded-full bg-amber"
						/>
						<span className="max-sm:sr-only">{UNPROTECTED_NOTICE}</span>
						<span aria-hidden className="sm:hidden">
							No password set
						</span>
						<Link
							to="/settings"
							hash="access"
							className="shrink-0 font-semibold text-amber-foreground underline-offset-4 hover:underline"
						>
							Set one
						</Link>
					</output>
				)}
			</header>
			<Outlet />
		</div>
	);
}
