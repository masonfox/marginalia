import { Link } from "@tanstack/react-router";
import { cn } from "cn";

/**
 * Styled from the router's `aria-current="page"`. A filled pill rather than
 * an underline, so it reads the same beside the app name and on its own row
 * below sm. Touch-sized below sm and on coarse pointers.
 */
const ENTRY =
	"inline-flex shrink-0 items-center rounded-md px-3 py-1.5 whitespace-nowrap text-muted-foreground hover:bg-accent/60 hover:text-foreground max-sm:min-h-11 pointer-coarse:min-h-11 aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground";

/**
 * The app header's switch between the dashboard and the conversations page.
 * On other pages neither entry is current. The Dashboard link carries no
 * search: going back restores a filtered library, as its URL holds the
 * search and filter.
 */
export function HomeNav({ className }: { className?: string }) {
	return (
		<nav
			aria-label="Main"
			className={cn("flex gap-1 text-sm", className)}
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
