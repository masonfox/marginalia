import { getRouteApi, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useCallback, useState } from "react";
import { BookCover, coverColors } from "#/components/book-cover";
import { ReadingPositionControl } from "#/components/reading-position";
import { Badge } from "#/components/ui/badge";

const bookRoute = getRouteApi("/books/$editionId");

/**
 * The book page's loader data, shared by every tab, with `isReady`: whether
 * the edition finished importing. Tabs that need a ready book (the Guide,
 * Discuss's composer) check it.
 */
export function useBook() {
	const data = bookRoute.useLoaderData();
	return { ...data, isReady: data.edition.status === "ready" };
}

/**
 * The average color of a loaded, same-origin cover image, as `rgb(...)`, or
 * null when it cannot be read (not decoded yet, no canvas, a tainted canvas).
 * Drawing it down to a few pixels is cheap and needs nothing from the server.
 */
export function averageColor(img: HTMLImageElement): string | null {
	if (!img.complete || img.naturalWidth === 0) return null;
	try {
		const size = 8;
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return null;
		ctx.drawImage(img, 0, 0, size, size);
		const { data } = ctx.getImageData(0, 0, size, size);
		let r = 0;
		let g = 0;
		let b = 0;
		let n = 0;
		for (let i = 0; i < data.length; i += 4) {
			const a = data[i + 3] ?? 0;
			if (a === 0) continue;
			r += data[i] ?? 0;
			g += data[i + 1] ?? 0;
			b += data[i + 2] ?? 0;
			n++;
		}
		if (n === 0) return null;
		return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
	} catch {
		return null;
	}
}

/**
 * The hero's tint: the typeset cover's color for a book without a cover, the
 * cover image's average color once it has loaded, and a neutral warm grey
 * (the faint ink) until then or when it cannot be read.
 */
function useCoverTint(id: string, title: string, hasCover: boolean) {
	const [sampled, setSampled] = useState<{
		id: string;
		color: string | null;
	} | null>(null);
	const imageRef = useCallback(
		(img: HTMLImageElement | null) => {
			if (!img) return;
			const read = () => setSampled({ id, color: averageColor(img) });
			// The image may have loaded before hydration, when no load event is left.
			if (img.complete) read();
			else img.addEventListener("load", read, { once: true });
			return () => img.removeEventListener("load", read);
		},
		[id],
	);
	const tint = hasCover
		? ((sampled?.id === id ? sampled.color : null) ?? "var(--faint-foreground)")
		: coverColors(title).background;
	return { tint, imageRef };
}

/** Mix a color into transparency by the theme's tint strength (set on the backdrop). */
const mix = (color: string, strength: string) =>
	`color-mix(in srgb, ${color} var(${strength}), transparent)`;

/**
 * The backdrop's strengths per theme, from the mockups' `--tint` and `--glow`:
 * the cover tint is strongest on dark, the amber glow strongest on sepia.
 */
const BACKDROP =
	"pointer-events-none absolute inset-0 [--hero-tint:12%] [--hero-glow:12%] sepia:[--hero-tint:16%] sepia:[--hero-glow:16%] dark:[--hero-tint:55%] dark:[--hero-glow:10%]";

/**
 * The book hero above every tab: cover, title, authors, and either the import
 * status (not ready) or the reading position, over a radial tint taken from
 * the cover, with the book's tabs along its bottom edge. `full` (Discuss,
 * Contents) has a large cover and title; `compact` (Guide, About) a small cover
 * and title so the tab's content leads.
 */
export function BookHero({ variant }: { variant: "full" | "compact" }) {
	const { edition, isReady } = useBook();
	const hasCover = Boolean(edition.coverPath);
	const { tint, imageRef } = useCoverTint(edition.id, edition.title, hasCover);
	const full = variant === "full";
	const background = full
		? `radial-gradient(50% 100% at 10% 30%, ${mix(tint, "--hero-tint")}, transparent 72%), radial-gradient(40% 80% at 95% 0%, ${mix("var(--amber)", "--hero-glow")}, transparent 70%)`
		: `radial-gradient(40% 140% at 6% 50%, ${mix(tint, "--hero-tint")}, transparent 72%)`;

	return (
		<header
			className="relative overflow-hidden border-b"
			data-variant={variant}
			data-testid="book-hero"
		>
			<div aria-hidden className={BACKDROP} style={{ background }} />
			<div
				className={cn(
					"relative mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8",
					full ? "pt-6 sm:pt-12" : "pt-5 sm:pt-7",
				)}
			>
				<div
					className={cn(
						"flex flex-wrap",
						full
							? "items-end gap-x-5 gap-y-4 sm:gap-x-12"
							: "items-center gap-x-[22px] gap-y-3",
					)}
				>
					<div
						className={cn(
							"shrink-0",
							full ? "w-20 self-start sm:w-[196px] sm:self-end" : "w-16",
						)}
					>
						<BookCover
							id={edition.id}
							title={edition.title}
							author={edition.authors[0]}
							hasCover={hasCover}
							small={!full}
							loading="eager"
							imageRef={imageRef}
						/>
					</div>
					<div
						className={cn(
							"min-w-0",
							full ? "flex-[999_1_14rem] sm:pb-1.5" : "flex-[1_1_14rem]",
						)}
					>
						<h1
							id="book-title"
							className={cn(
								"font-serif leading-[1.02] font-semibold tracking-[-0.015em] break-words",
								full
									? "text-[34px] sm:text-[clamp(48px,5.6vw,80px)]"
									: "text-[28px] sm:text-[40px]",
							)}
						>
							{edition.title}
						</h1>
						{edition.authors.length > 0 && (
							<p
								className={cn(
									"text-muted-foreground",
									full ? "mt-2 sm:text-lg" : "mt-1",
								)}
							>
								{edition.authors.join(", ")}
							</p>
						)}
						{full && (
							<div className="mt-4 sm:mt-[26px]">
								<HeroStatus />
							</div>
						)}
					</div>
					{!full && (
						<div className="max-w-full">
							<HeroStatus compact />
						</div>
					)}
				</div>
				<BookTabs
					className={full ? "mt-6 sm:mt-10" : "mt-4 sm:mt-5"}
					editionId={edition.id}
					isReady={isReady}
				/>
			</div>
		</header>
	);
}

/** The reading position (ready) or the import status and error (not ready). */
function HeroStatus({ compact = false }: { compact?: boolean }) {
	const { edition, isReady } = useBook();
	if (isReady)
		return <ReadingPositionControl editionId={edition.id} compact={compact} />;
	return (
		<div className="space-y-1">
			<Badge
				variant={edition.displayStatus === "failed" ? "destructive" : "status"}
				className={cn(
					"max-w-full whitespace-normal break-words",
					edition.displayStatus !== "failed" && "text-status-processing",
				)}
				data-testid="import-status"
			>
				{edition.displayStatus}
			</Badge>
			{edition.error && (
				<p className="text-sm break-words text-destructive-foreground">
					{edition.error}
				</p>
			)}
		</div>
	);
}

/**
 * The current tab is styled from the router's `aria-current="page"` rather
 * than `activeProps` classes: those are appended to these, and Tailwind orders
 * same-property utilities itself, so `border-transparent` and
 * `text-muted-foreground` would still win. The current tab is underlined in
 * amber, over the hero's bottom border.
 */
const TAB =
	"shrink-0 rounded-t-sm border-b-2 border-transparent px-0.5 pt-[15px] pb-[14px] text-sm leading-none font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset aria-[current=page]:border-amber aria-[current=page]:text-foreground";

/**
 * The book's tabs as links: each is a page with its own URL, and the router
 * marks the current one with `aria-current="page"`. The Guide is current on
 * every `/guide/*` path and is only offered for ready editions. Being links,
 * they are reached with Tab and followed with Enter.
 *
 * The row scrolls sideways on narrow screens; it sits on the hero's bottom
 * border, so the current tab's underline meets that line without the row
 * needing to overflow it.
 */
export function BookTabs({
	editionId,
	isReady,
	className,
}: {
	editionId: string;
	isReady: boolean;
	className?: string;
}) {
	const params = { editionId };
	return (
		<nav
			aria-label="Book"
			className={cn(
				"flex gap-6 overflow-x-auto overflow-y-hidden sm:gap-8",
				className,
			)}
			data-testid="book-tabs"
		>
			<Link
				to="/books/$editionId"
				params={params}
				activeOptions={{ exact: true, includeSearch: false }}
				className={TAB}
			>
				Discuss
			</Link>
			{isReady && (
				<Link
					to="/books/$editionId/guide"
					params={params}
					activeOptions={{ includeSearch: false }}
					className={TAB}
				>
					Guide
				</Link>
			)}
			<Link
				to="/books/$editionId/contents"
				params={params}
				activeOptions={{ includeSearch: false }}
				className={TAB}
			>
				Contents
			</Link>
			<Link to="/books/$editionId/about" params={params} className={TAB}>
				About
			</Link>
		</nav>
	);
}
