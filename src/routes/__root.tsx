import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
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
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Marginalia" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
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
					Back to the library
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

function AppShell() {
	const shell = Route.useLoaderData();
	const onLogin = useRouterState({
		select: (s) => s.location.pathname === "/login",
	});
	return (
		<div className="min-h-screen">
			<header className="border-b">
				<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
					<Link
						to="/"
						className="font-serif text-xl font-semibold tracking-tight"
					>
						Marginalia
					</Link>
					{shell.authEnabled && !onLogin && (
						<form method="post" action="/logout">
							<Button type="submit" variant="ghost" size="sm">
								Log out
							</Button>
						</form>
					)}
				</div>
				{!shell.authEnabled && (
					<output className="block border-t bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
						No password set: anyone who can reach this instance can use it.
					</output>
				)}
			</header>
			<Outlet />
		</div>
	);
}
