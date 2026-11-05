import { Link } from "@tanstack/react-router";

/**
 * Styled from the router's `aria-current="page"`, as the book tabs are (see
 * `TAB` in book-page.tsx). Touch-sized on coarse pointers.
 */
const ENTRY =
	"inline-flex shrink-0 items-center border-b-2 border-transparent px-3 py-2 whitespace-nowrap text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground";

/**
 * Switches between the dashboard and the conversations page. The Dashboard link
 * carries no search: going back restores a filtered library, as its URL
 * holds the search and filter.
 */
export function HomeNav() {
	return (
		<nav
			aria-label="Home"
			className="flex gap-1 text-sm shadow-[inset_0_-1px_0_var(--color-border)]"
			data-testid="home-nav"
		>
			<Link
				to="/"
				activeOptions={{ exact: true, includeSearch: false }}
				className={ENTRY}
			>
				Dashboard
			</Link>
			<Link
				to="/conversations"
				activeOptions={{ includeSearch: false }}
				className={ENTRY}
			>
				Conversations
			</Link>
		</nav>
	);
}
