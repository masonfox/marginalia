import { Link } from "@tanstack/react-router";
import type { PassageSnapshot } from "#/lib/passage-ref";

/** A referenced passage: verified book text, labelled and linked to the passage view. */
export function PassageQuote({ snapshot }: { snapshot: PassageSnapshot }) {
	const source = [snapshot.bookTitle, snapshot.sectionTitle]
		.filter(Boolean)
		.join(" · ");
	return (
		<aside
			className="mb-2 border-l-2 border-l-primary pl-3 text-sm whitespace-normal"
			data-testid="passage-quote"
			aria-label="Passage from the book"
		>
			<p className="text-xs font-medium text-muted-foreground">
				Passage from the book · {source}
			</p>
			<blockquote className="mt-1 font-serif text-base whitespace-pre-line">
				{snapshot.text}
			</blockquote>
			<Link
				to="/p/$locator"
				params={{ locator: snapshot.locator }}
				search={
					snapshot.range
						? { hl: `${snapshot.range.start}-${snapshot.range.end}` }
						: {}
				}
				className="mt-1 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
			>
				Open in book →
			</Link>
		</aside>
	);
}
