import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ThemeSwitch } from "#/components/theme-switch";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";

const MESSAGES = {
	incorrect: "Incorrect password",
	limited: "Too many attempts. Try again later.",
} as const;

export const Route = createFileRoute("/login")({
	validateSearch: z.object({
		next: z.string().optional(),
		error: z.enum(["incorrect", "limited"]).optional(),
	}),
	head: () => ({ meta: [{ title: "Log in · Marginalia" }] }),
	component: LoginPage,
});

/** A plain form post to `/login`, so logging in works without client JavaScript. */
function LoginPage() {
	const { next, error } = Route.useSearch();
	return (
		<main className="relative isolate grid min-h-dvh overflow-hidden place-items-center px-5 py-28">
			<ThemeSwitch className="absolute top-5 right-5" />
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_38%,var(--amber-soft),transparent_65%)]"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-60 overflow-hidden opacity-60"
			>
				{["#1d3a5f", "#6b2d2a", "#4d4a44", "#1f4a43", "#b5592a", "#c9d3cf"].map(
					(color, index) => (
						<div
							key={color}
							className="absolute top-16 h-72 w-[14%] min-w-20 rounded-[3px_7px_7px_3px] border border-white/10 shadow-cover"
							style={{
								backgroundColor: color,
								left: `${6 + index * 15}%`,
								transform: `translateY(${index === 2 || index === 3 ? 55 : index === 1 || index === 4 ? 25 : 0}px) rotate(${[-8, 4, -3, 5, -4, 8][index]}deg)`,
							}}
						/>
					),
				)}
				<div className="absolute inset-0 bg-gradient-to-b from-background to-transparent" />
			</div>
			<div className="w-full max-w-[420px] -translate-y-8 text-center">
				<svg
					aria-hidden="true"
					className="mx-auto size-11 text-amber-foreground"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3.5" y="2.5" width="17" height="19" rx="2.5" />
					<path d="M8.5 2.5v19M11.5 8h5.5M11.5 12h5.5M11.5 16h3.5M5.6 9.5h.8M5.6 13.5h.8" />
				</svg>
				<h1 className="mt-5 font-serif text-[64px] leading-none font-semibold tracking-[-0.015em]">
					Marginalia
				</h1>
				<p className="mt-4 text-base text-muted-foreground">
					Enter this library's password.
				</p>
				<form
					method="post"
					action="/login"
					aria-label="Log in"
					className="mt-10 space-y-3 text-left"
				>
					<input type="hidden" name="next" value={next ?? "/"} />
					<label className="block text-sm font-medium" htmlFor="password">
						Password
					</label>
					<div className="flex flex-wrap gap-2.5">
						<Input
							className="min-h-12 min-w-0 flex-1 text-base"
							id="password"
							name="password"
							type="password"
							autoComplete="current-password"
							required
							autoFocus
							aria-invalid={error ? true : undefined}
							aria-describedby={error ? "login-error" : undefined}
						/>
						{error && (
							<p
								id="login-error"
								role="alert"
								className="order-3 w-full text-sm text-destructive-foreground"
							>
								{MESSAGES[error]}
							</p>
						)}
						<Button type="submit" className="min-h-12 px-5">
							Log in
						</Button>
					</div>
				</form>
			</div>
		</main>
	);
}
