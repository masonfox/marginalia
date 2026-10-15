// Margin glosses in the passage reader (design D8): marked subject mentions,
// the card a mention opens, and the reader's controls. Everything shown is
// bounded by the passage on screen, never by the reading position.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { Popover } from "radix-ui";
import { type KeyboardEvent, useState } from "react";
import { CorrectedBadge } from "#/components/corrections";
import { KIND_LABELS } from "#/components/guide";
import {
	asOfText,
	NoteBody,
	noteFrame,
	YourNoteBadge,
} from "#/components/guide-notes";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { getGlossCardFn } from "#/fns/guide";
import type { Gloss, GlossExclusion } from "#/modules/guide";

const cardClass =
	"z-50 max-h-[70vh] w-96 max-w-[90vw] overflow-y-auto rounded-md border bg-popover p-3 font-sans text-sm text-popover-foreground shadow-md";

/**
 * A marked mention. It opens the subject's card as of the passage it is in.
 * A span rather than a button, so the passage's text stays selectable.
 */
export function GlossMark({
	gloss,
	text,
	editionId,
	onExclude,
}: {
	gloss: Gloss;
	text: string;
	editionId: string;
	/** "Don't gloss this name": `text` is the name as it appears here. */
	onExclude: (gloss: Gloss, text: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		setOpen(true);
	};
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild>
				{/* biome-ignore lint/a11y/useSemanticElements: a button would make the name unselectable in some browsers */}
				<span
					role="button"
					tabIndex={0}
					onKeyDown={onKeyDown}
					data-testid="gloss"
					data-subject={gloss.subjectRef}
					className="cursor-pointer rounded-sm bg-transparent text-inherit underline decoration-primary/60 decoration-dotted decoration-2 underline-offset-4 hover:bg-highlight/60 focus-visible:outline-2 focus-visible:outline-ring"
				>
					{text}
				</span>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="bottom"
					align="start"
					sideOffset={6}
					collisionPadding={8}
					className={cardClass}
					data-testid="gloss-card"
				>
					<GlossCardView
						gloss={gloss}
						editionId={editionId}
						onExclude={() => {
							setOpen(false);
							onExclude(gloss, text);
						}}
						name={text}
					/>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

function GlossCardView({
	gloss,
	editionId,
	name,
	onExclude,
}: {
	gloss: Gloss;
	editionId: string;
	name: string;
	onExclude: () => void;
}) {
	const card = useQuery({
		queryKey: ["gloss-card", editionId, gloss.subjectRef, gloss.locator],
		queryFn: () =>
			getGlossCardFn({
				data: {
					editionId,
					subjectRef: gloss.subjectRef,
					locator: gloss.locator,
				},
			}),
	});
	const exclude = (
		<Button
			type="button"
			size="sm"
			variant="ghost"
			onClick={onExclude}
			data-testid="gloss-exclude"
		>
			Don't gloss “{name}”
		</Button>
	);
	if (card.isPending) return <p className="text-muted-foreground">Loading…</p>;
	if (card.isError)
		return (
			<p role="alert" className="text-destructive-foreground">
				Couldn't load what the guide knows.
			</p>
		);
	const c = card.data;
	if (!c)
		return (
			<>
				<p className="text-muted-foreground">
					The guide has nothing on this name as of this passage.
				</p>
				<div className="mt-2">{exclude}</div>
			</>
		);
	const more = c.observationCount - c.observations.length;
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="font-serif text-base font-semibold">{c.name}</h3>
				<Badge variant="outline">{KIND_LABELS[c.kind].singular}</Badge>
			</div>
			<p className="mt-0.5 text-xs text-muted-foreground">
				As of the end of {c.asOfLabel}
			</p>
			<ul className="mt-2 space-y-2">
				{c.observations.map((o, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: observations have no id of their own
					<li key={i}>
						<p className="text-xs text-muted-foreground">
							{o.unitLabel}
							{o.observedAs && ` · as “${o.observedAs}”`}
						</p>
						<p>{o.note}</p>
						{o.corrected && <CorrectedBadge />}
					</li>
				))}
			</ul>
			{c.notes.length > 0 && (
				<ul className="mt-3 space-y-2">
					{c.notes.map((n) => (
						<li
							key={n.id}
							className={cn(noteFrame, "p-2")}
							data-testid="gloss-note"
						>
							<div className="flex flex-wrap items-center gap-2">
								<YourNoteBadge />
								<Link
									to="/books/$editionId/guide/notes/$noteId"
									params={{ editionId, noteId: String(n.id) }}
									className="font-medium hover:underline"
								>
									{n.title}
								</Link>
							</div>
							<p className="mt-0.5 text-xs text-muted-foreground">
								{asOfText(n.asOf)}
							</p>
							<div className="mt-1 max-h-24 overflow-hidden">
								<NoteBody body={n.body} />
							</div>
						</li>
					))}
				</ul>
			)}
			<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
				<Link
					to="/books/$editionId/guide/index/$subjectRef"
					params={{ editionId, subjectRef: c.ref }}
					className="text-sm underline underline-offset-2"
					data-testid="gloss-guide-link"
				>
					{more > 0 ? `${more} more in the Guide →` : "Open in the Guide →"}
				</Link>
				{exclude}
			</div>
		</>
	);
}

/**
 * The reader's controls: glosses on or off (remembered by this browser),
 * the name just excluded with undo, and the names not glossed in this book.
 */
export function GlossControls({
	on,
	onToggle,
	excluded,
	justExcluded,
	onInclude,
}: {
	on: boolean;
	onToggle: (on: boolean) => void;
	excluded: GlossExclusion[];
	justExcluded: { nameKey: string; name: string } | null;
	onInclude: (nameKey: string) => void;
}) {
	return (
		<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
			<Button
				type="button"
				size="sm"
				variant="outline"
				aria-pressed={on}
				onClick={() => onToggle(!on)}
				data-testid="gloss-toggle"
			>
				Margin glosses: {on ? "on" : "off"}
			</Button>
			{on && justExcluded && (
				<output data-testid="gloss-excluded-notice">
					“{justExcluded.name}” won't be glossed in this book.{" "}
					<button
						type="button"
						className="cursor-pointer underline underline-offset-2 hover:text-foreground"
						onClick={() => onInclude(justExcluded.nameKey)}
					>
						Undo
					</button>
				</output>
			)}
			{on && excluded.length > 0 && (
				<details data-testid="gloss-excluded">
					<summary className="cursor-pointer">
						{excluded.length === 1
							? "1 name not glossed"
							: `${excluded.length} names not glossed`}
					</summary>
					<ul className="mt-1 space-y-1">
						{excluded.map((e) => (
							<li key={e.nameKey}>
								{e.name}{" "}
								<button
									type="button"
									className="cursor-pointer underline underline-offset-2 hover:text-foreground"
									onClick={() => onInclude(e.nameKey)}
								>
									Gloss again
								</button>
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}
