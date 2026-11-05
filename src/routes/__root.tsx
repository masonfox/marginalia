import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import { HomeNav } from "#/components/home-nav";
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
				{/* Below sm the navigation wraps onto its own row under the app name. */}
				<div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
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
					{/* Icon-only below sm, each still named for assistive tech. */}
					{!onLogin && (
						<HomeNav className="max-sm:order-last max-sm:basis-full" />
					)}
					{!onLogin && (
						<div className="ml-auto flex items-center gap-1">
							<Button
								asChild
								variant="ghost"
								size="sm"
								className="max-sm:size-11 max-sm:px-0"
							>
								<Link to="/settings" aria-label="Settings">
									<Settings aria-hidden className="sm:hidden" />
									<span className="max-sm:sr-only">Settings</span>
								</Link>
							</Button>
							{shell.authEnabled && (
								<form method="post" action="/logout">
									<Button
										type="submit"
										variant="ghost"
										size="sm"
										aria-label="Log out"
										className="max-sm:size-11 max-sm:px-0"
									>
										<LogOut aria-hidden className="sm:hidden" />
										<span className="max-sm:sr-only">Log out</span>
									</Button>
								</form>
							)}
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
