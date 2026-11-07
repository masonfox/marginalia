import { cn } from "cn";
import type { Ref } from "react";

/**
 * Cloth colors for typeset covers, background and ink, from the mockups'
 * covers without art. A title always maps to the same pair.
 */
export const COVER_PALETTE = [
	{ background: "#1d3a5f", color: "#f1e6cf" },
	{ background: "#1f4a43", color: "#e6c97a" },
	{ background: "#2b2b2b", color: "#d9b26a" },
	{ background: "#3a4a3a", color: "#efe3c8" },
	{ background: "#4d4a44", color: "#efe9dc" },
	{ background: "#6b2d2a", color: "#f2dfc4" },
	{ background: "#8a1c1c", color: "#f5e9d6" },
	{ background: "#b5592a", color: "#1f120a" },
	{ background: "#c9d3cf", color: "#24433f" },
	{ background: "#dfe6ea", color: "#24313a" },
	{ background: "#e8b64a", color: "#2a1a0e" },
	{ background: "#efe3cf", color: "#5a3418" },
] as const;

export type CoverColors = (typeof COVER_PALETTE)[number];

/** FNV-1a over the title's UTF-16 code units: small, stable, and well spread. */
function hashTitle(title: string) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < title.length; i++) {
		hash ^= title.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** The typeset cover's colors for a title. */
export function coverColors(title: string): CoverColors {
	return COVER_PALETTE[
		hashTitle(title.trim()) % COVER_PALETTE.length
	] as CoverColors;
}

/** "Herman Melville" → "Melville"; "Melville, Herman" → "Melville". */
export function surname(author: string) {
	const name = author.trim();
	if (name.includes(",")) return name.slice(0, name.indexOf(",")).trim();
	const words = name.split(/\s+/);
	return words[words.length - 1] ?? "";
}

/** "Infinite Jest" → "IJ", "Moby-Dick" → "MD", "The Waves" → "W": for covers too small for a title. */
export function initials(title: string) {
	const words = title
		.split(/[\s\-–—:]+/)
		.filter((w) => /[\p{L}\p{N}]/u.test(w));
	const significant =
		words.length > 1 && /^(the|a|an)$/i.test(words[0] ?? "")
			? words.slice(1)
			: words;
	return significant
		.slice(0, 2)
		.map((w) => [...w.replace(/^[^\p{L}\p{N}]+/u, "")][0] ?? "")
		.join("")
		.toUpperCase();
}

/** The cover shape shared by images and typeset covers: 2:3, a bound spine edge, the cover shadow. */
export const COVER_SHAPE =
	"aspect-[2/3] w-full rounded-[3px_7px_7px_3px] shadow-cover";

/**
 * A book's cover image, or a typeset cover when it has none: the title in the
 * display face and the first author's surname in small capitals, on a cloth
 * color picked by a hash of the title, with a shaded spine. The typeset cover
 * is an image named by the title; a real cover keeps an empty alt because the
 * title is always printed beside it.
 */
export function BookCover({
	id,
	title,
	hasCover,
	author,
	small = false,
	loading = "lazy",
	imageRef,
	className,
}: {
	id: string;
	title: string;
	hasCover: boolean;
	/** The first author, whose surname goes on a typeset cover. */
	author?: string;
	/** A thumbnail too small for a title: a typeset cover shows initials instead. */
	small?: boolean;
	loading?: "lazy" | "eager";
	imageRef?: Ref<HTMLImageElement>;
	className?: string;
}) {
	if (hasCover) {
		return (
			<img
				ref={imageRef}
				src={`/api/covers/${id}`}
				alt=""
				loading={loading}
				className={cn(COVER_SHAPE, "object-cover", className)}
			/>
		);
	}
	return (
		<TypesetCover
			title={title}
			author={author}
			small={small}
			className={className}
		/>
	);
}

export function TypesetCover({
	title,
	author,
	small = false,
	className,
}: {
	title: string;
	author?: string;
	small?: boolean;
	className?: string;
}) {
	const colors = coverColors(title);
	const name = author && !small ? surname(author) : "";
	return (
		<div
			role="img"
			aria-label={title}
			data-slot="typeset-cover"
			style={{ background: colors.background, color: colors.color }}
			className={cn(
				COVER_SHAPE,
				// The spine (::before) and a soft sheen across the board (::after).
				"@container relative flex flex-col justify-between overflow-hidden pt-[13%] pr-[11%] pb-[11%] pl-[14%]",
				"before:absolute before:inset-y-0 before:left-0 before:w-[7%] before:bg-[linear-gradient(90deg,rgba(0,0,0,.28),rgba(255,255,255,.10)_70%,transparent)] before:content-['']",
				"after:pointer-events-none after:absolute after:inset-0 after:bg-[linear-gradient(160deg,rgba(255,255,255,.10),transparent_40%,rgba(0,0,0,.12))] after:content-['']",
				className,
			)}
		>
			{small ? (
				<span className="font-serif text-[34cqw] leading-[0.95] font-semibold tracking-[-0.01em]">
					{initials(title)}
				</span>
			) : (
				<span className="line-clamp-5 font-serif text-[16cqw] leading-[0.95] font-semibold tracking-[-0.01em] break-words hyphens-auto">
					{title}
				</span>
			)}
			{name && (
				<span className="truncate font-sans text-[6.5cqw] leading-[1.2] font-semibold tracking-[0.14em] uppercase opacity-85">
					{name}
				</span>
			)}
		</div>
	);
}
