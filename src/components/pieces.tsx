import { cn } from "cn";
import { Bookmark } from "lucide-react";
import type { ComponentProps } from "react";

/**
 * Small shared pieces from the design system (`Main.dc.html` "Pieces"): the
 * eyebrow label, the scope pill, citation markers, and the progress bar.
 * Status badges are the `status` variant of `ui/badge`.
 */

/** 11px uppercase label in the faint ink, above a section or field (the mockups' .eyebrow). */
export const EYEBROW =
	"text-[11px] leading-[1.2] font-semibold tracking-[0.14em] text-faint-foreground uppercase";

export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
	return <p className={cn(EYEBROW, className)} {...props} />;
}

/**
 * The scope pill: the one amber shape that means "the assistant can read this
 * far". Uppercase is visual only, so its text stays as written for tests and
 * assistive technology. Long chapter labels wrap rather than overflow.
 */
export const SCOPE_PILL =
	"inline-flex max-w-full min-h-7 items-center gap-[7px] rounded-full bg-amber-soft px-[11px] py-1 text-left text-[11.5px] leading-tight font-semibold tracking-[0.04em] break-words text-amber-foreground uppercase [&>svg]:size-[13px] [&>svg]:shrink-0";

export function ScopePill({
	className,
	children,
	icon = true,
	...props
}: ComponentProps<"span"> & {
	/** The bookmark icon; off for the small in-row markers ("Your position"). */
	icon?: boolean;
}) {
	return (
		<span
			data-slot="scope-pill"
			className={cn(SCOPE_PILL, className)}
			{...props}
		>
			{icon && <Bookmark aria-hidden strokeWidth={2} />}
			<span className="min-w-0">{children}</span>
		</span>
	);
}

/**
 * A verified citation's numbered marker: a 19px amber-soft badge, solid amber
 * while its popover is open (Radix sets `data-state="open"` on the trigger).
 * The active ink is the mockups' fixed near-black (`.cite.act`) in every theme.
 */
export const CITE_MARKER =
	"ml-[3px] inline-grid h-[19px] min-w-[19px] cursor-pointer place-items-center rounded-full bg-amber-soft px-[5px] align-[2px] font-sans text-[10.5px] leading-none font-bold not-italic text-amber-foreground hover:bg-amber/25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-[state=open]:bg-amber data-[state=open]:text-[#1a0f05] pointer-coarse:h-[22px] pointer-coarse:min-w-[22px] pointer-coarse:px-1.5 pointer-coarse:text-[11px]";

/** A citation that could not be verified: the same shape in the error ink, no number. */
export const CITE_MARKER_UNVERIFIED =
	"ml-[3px] inline-grid size-[19px] cursor-pointer place-items-center rounded-full bg-destructive-foreground/15 align-[2px] text-destructive-foreground hover:bg-destructive-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-[state=open]:bg-destructive-foreground/30 pointer-coarse:size-[22px] [&>svg]:size-3";

/** An unverified quote: error ink with a wavy underline, so it never reads as book text. */
export const UNVERIFIED_QUOTE =
	"text-destructive-foreground underline decoration-destructive-foreground decoration-wavy decoration-1 underline-offset-[3px]";

/**
 * A 4px progress bar: amber fill on the input-line track (the mockups' .bar).
 * `value` is a share from 0 to 1; `label` names it for assistive technology.
 */
export function ProgressBar({
	value,
	label,
	className,
	fillClassName,
	...props
}: Omit<ComponentProps<"div">, "role" | "children"> & {
	value: number;
	label: string;
	fillClassName?: string;
}) {
	const share = Math.min(1, Math.max(0, value));
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(share * 100)}
			className={cn("h-1 overflow-hidden rounded-full bg-input", className)}
			{...props}
		>
			<div
				className={cn("h-full rounded-full bg-amber", fillClassName)}
				style={{ width: `${share * 100}%` }}
			/>
		</div>
	);
}
