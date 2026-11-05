import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { HeaderMenu, HomeNav } from "#/components/home-nav";
import { NewConversation } from "#/components/new-conversation";
import { Button } from "#/components/ui/button";
import { getShellInfo } from "#/fns/library";
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
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.ico?v=2", sizes: "any" },
			{
				rel: "icon",
				type: "image/png",
				sizes: "16x16",
				href: "/assets/brand/icon-16.png?v=2",
			},
			{
				rel: "icon",
				type: "image/png",
				sizes: "32x32",
				href: "/assets/brand/icon-32.png?v=2",
			},
			{
				rel: "apple-touch-icon",
				sizes: "180x180",
				href: "/assets/brand/icon-180.png?v=2",
			},
			{ rel: "manifest", href: "/assets/brand/site.webmanifest" },
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
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}

const UNPROTECTED_NOTICE =
	"No password set: anyone who can reach this instance can use it.";

function AppShell() {
	const shell = Route.useLoaderData();
	const onLogin = useRouterState({
		select: (s) => s.location.pathname === "/login",
	});
	return (
		<div className="min-h-screen">
			<header className="border-b">
				{/* One row at every width. */}
				<div className="mx-auto flex max-w-5xl items-center gap-x-4 px-4 py-3">
					<Link
						to="/"
						className="flex shrink-0 items-center gap-2 font-serif text-xl font-semibold tracking-tight"
					>
						<span
							className="flex size-10 items-center justify-center overflow-hidden"
							aria-hidden="true"
						>
							<img
								src="/assets/brand/logo.png"
								alt=""
								width={72}
								height={72}
								className="size-[72px] max-w-none shrink-0"
							/>
						</span>
						Marginalia
					</Link>
					{/* Below sm the navigation, Settings, and Log out are in the menu. */}
					{!onLogin && <HomeNav className="max-sm:hidden" />}
					{!onLogin && (
						<div className="ml-auto flex items-center gap-1">
							<NewConversation />
							<Button
								asChild
								variant="ghost"
								size="sm"
								className="max-sm:hidden"
							>
								<Link to="/settings">Settings</Link>
							</Button>
							{shell.authEnabled && (
								<form method="post" action="/logout" className="max-sm:hidden">
									<Button type="submit" variant="ghost" size="sm">
										Log out
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
						className="block border-t bg-muted px-4 py-2 text-center text-sm text-muted-foreground max-sm:truncate max-sm:text-xs"
						title={UNPROTECTED_NOTICE}
						data-testid="unprotected-notice"
					>
						<span className="sm:hidden">
							No password set: anyone with access can use this instance.
						</span>
						<span className="max-sm:hidden">{UNPROTECTED_NOTICE}</span>
					</output>
				)}
			</header>
			<Outlet />
		</div>
	);
}
