import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
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
		<main className="mx-auto max-w-sm px-4 py-16">
			<h1 className="font-serif text-2xl font-semibold">Log in</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Enter this library's password.
			</p>
			<form method="post" action="/login" className="mt-6 space-y-3">
				<input type="hidden" name="next" value={next ?? "/"} />
				<label className="block text-sm font-medium" htmlFor="password">
					Password
				</label>
				<Input
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
						className="text-sm text-destructive-foreground"
					>
						{MESSAGES[error]}
					</p>
				)}
				<Button type="submit" className="w-full">
					Log in
				</Button>
			</form>
		</main>
	);
}
