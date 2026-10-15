import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	Outlet,
} from "@tanstack/react-router";
import { Eye, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";
import { z } from "zod";
import {
	boundEnd,
	type GuideBound,
	GuideContext,
	positionBound,
} from "#/components/guide";
import { CorrectionReviewPanel } from "#/components/guide-corrections";
import {
	type Choice,
	ScopeChoices,
	STALE,
	scopeText,
} from "#/components/scope";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { getReadingUnitsFn } from "#/fns/conversations";
import { getGuideFn } from "#/fns/guide";
import type { ReadingUnit } from "#/modules/catalog";

export const Route = createFileRoute("/books/$editionId_/guide")({
	loader: async ({ params }) => {
		if (!z.uuid().safeParse(params.editionId).success) throw notFound();
		const guide = await getGuideFn({ data: { editionId: params.editionId } });
		if (!guide) throw notFound();
		return guide;
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `Guide to ${loaderData.edition.title} · Marginalia`
					: "Marginalia",
			},
		],
	}),
	component: GuideLayout,
});

/** The bound of a choice among `units`, or null when the unit is not offered. */
function toBound(choice: Choice, units: ReadingUnit[]): GuideBound | null {
	if (choice === "whole") return { choice: { kind: "whole" }, label: null };
	const unit = units.find((u) => `unit:${u.endPosition}` === choice);
	return unit
		? {
				choice: { kind: "unit", endPosition: unit.endPosition },
				label: unit.label,
			}
		: null;
}

const toChoice = (bound: GuideBound | null): Choice | null =>
	bound === null
		? null
		: bound.choice.kind === "whole"
			? "whole"
			: `unit:${bound.choice.endPosition}`;

/**
 * The Guide's frame. It holds the visit's bound in React state only, so a
 * peek ends when the reader leaves or reloads: it defaults to the reading
 * position, asks with nothing preselected when there is none, and confirms
 * before peeking past the position.
 */
function GuideLayout() {
	const { edition, position, preprocessed } = Route.useLoaderData();
	const units = useQuery({
		queryKey: ["reading-units", edition.id],
		queryFn: () => getReadingUnitsFn({ data: { editionId: edition.id } }),
		enabled: edition.status === "ready",
	});
	// The visit's own choice; null follows the reading position.
	const [visit, setVisit] = useState<GuideBound | null>(null);
	const [picking, setPicking] = useState(false);
	const [peekAt, setPeekAt] = useState<GuideBound | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const refetchUnits = units.refetch;
	// Stable, so views can call it from an effect.
	const onStaleBound = useCallback(() => {
		setVisit(null);
		setNotice(STALE);
		void refetchUnits();
	}, [refetchUnits]);
	const mine = units.data ? positionBound(position, units.data) : null;
	const bound = visit ?? mine;
	const peeking =
		mine !== null &&
		bound !== null &&
		boundEnd(bound.choice) > boundEnd(mine.choice);

	/** Applies a chosen bound, confirming first when it peeks past the position. */
	const choose = (next: GuideBound) => {
		setNotice(null);
		setPicking(false);
		if (mine !== null && boundEnd(next.choice) > boundEnd(mine.choice)) {
			setPeekAt(next);
		} else {
			setVisit(next);
		}
	};

	if (edition.status !== "ready") {
		return (
			<GuideFrame editionId={edition.id} title={edition.title}>
				<p className="mt-6 text-sm text-muted-foreground">
					The Guide is available once the book has finished importing.
				</p>
			</GuideFrame>
		);
	}

	return (
		<GuideFrame editionId={edition.id} title={edition.title}>
			<div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
				<span className="font-medium" data-testid="guide-bound">
					{bound ? scopeText(bound.label) : "Choose how far you have read"}
				</span>
				{(bound !== null || !preprocessed) && (
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={!units.data}
						onClick={() => setPicking(true)}
					>
						{bound ? "Change" : "Choose"}
					</Button>
				)}
				{position === null && (
					<span className="text-muted-foreground">
						No reading position is set for this book.
					</span>
				)}
			</div>
			{peeking && mine && (
				<div
					className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm"
					data-testid="guide-peek"
				>
					<Eye className="size-4 shrink-0" aria-hidden />
					<span className="flex-1">
						Peeking past your reading position ({scopeText(mine.label)}). Only
						this visit is affected.
					</span>
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => setVisit(null)}
					>
						<Undo2 aria-hidden /> Back to my position
					</Button>
				</div>
			)}
			{notice && (
				<p role="alert" className="mt-3 text-sm text-destructive-foreground">
					{notice}
				</p>
			)}
			<nav className="mt-6 flex gap-1 border-b text-sm" aria-label="Guide">
				{(
					[
						["/books/$editionId/guide/chapters", "Chapters"],
						["/books/$editionId/guide/index", "Index"],
						["/books/$editionId/guide/notes", "Notes"],
					] as const
				).map(([to, label]) => (
					<Link
						key={to}
						to={to}
						params={{ editionId: edition.id }}
						className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground"
						activeProps={{
							className: "border-primary font-medium text-foreground",
						}}
					>
						{label}
					</Link>
				))}
			</nav>
			<div className="mt-6">
				{bound === null && preprocessed ? (
					<FirstChoice
						units={units.data}
						error={units.isError}
						onChoose={choose}
					/>
				) : (
					<GuideContext.Provider
						value={{
							editionId: edition.id,
							bound,
							preprocessed,
							onStaleBound,
							units: units.data ?? [],
							position,
						}}
					>
						<CorrectionReviewPanel />
						<Outlet />
					</GuideContext.Provider>
				)}
			</div>
			{units.data && (
				<BoundPicker
					open={picking}
					onOpenChange={setPicking}
					units={units.data}
					current={bound}
					mine={mine}
					onChoose={choose}
				/>
			)}
			<AlertDialog
				open={peekAt !== null}
				onOpenChange={(next) => {
					if (!next) setPeekAt(null);
				}}
			>
				<AlertDialogContent data-testid="peek-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>
							Peek past your reading position?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Your position is {mine ? scopeText(mine.label) : "not set"}. The
							Guide will show summaries, subjects and notes{" "}
							{peekAt?.label ? `through ${peekAt.label}` : "for the whole book"}
							, which may spoil what you haven't read. Your reading position
							stays where it is, and the peek ends when you leave the Guide.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Stay at my position</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (peekAt) setVisit(peekAt);
								setPeekAt(null);
							}}
						>
							Show me
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</GuideFrame>
	);
}

function GuideFrame({
	editionId,
	title,
	children,
}: {
	editionId: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<main className="mx-auto max-w-3xl px-4 py-8">
			<p className="text-sm">
				<Link
					to="/books/$editionId"
					params={{ editionId }}
					className="text-muted-foreground hover:underline"
				>
					← {title}
				</Link>
			</p>
			<h1 className="mt-4 font-serif text-3xl font-semibold">Guide</h1>
			<p className="mt-1 text-muted-foreground">
				What has been derived about <em>{title}</em>, limited to how far you
				have read.
			</p>
			{children}
		</main>
	);
}

/** Asks how far the reader has read when there is no position, with nothing preselected. */
function FirstChoice({
	units,
	error,
	onChoose,
}: {
	units: ReadingUnit[] | undefined;
	error: boolean;
	onChoose: (bound: GuideBound) => void;
}) {
	const [choice, setChoice] = useState<Choice | null>(null);
	if (error)
		return (
			<p className="text-sm text-destructive-foreground">
				Could not load this book's chapters.
			</p>
		);
	if (!units)
		return <p className="text-sm text-muted-foreground">Loading chapters…</p>;
	const chosen = choice === null ? null : toBound(choice, units);
	return (
		<section
			className="max-w-xl space-y-3 rounded-md border p-4"
			aria-labelledby="guide-first-choice"
			data-testid="guide-first-choice"
		>
			<h2 id="guide-first-choice" className="font-medium">
				How far have you read?
			</h2>
			<p className="text-sm text-muted-foreground">
				The Guide shows nothing past the point you choose. Your choice lasts for
				this visit; set a reading position on the book's page to skip this
				question.
			</p>
			<ScopeChoices
				units={units}
				value={choice}
				legend="How far the Guide may show"
				onChange={setChoice}
			/>
			<Button
				type="button"
				disabled={chosen === null}
				onClick={() => {
					if (chosen) onChoose(chosen);
				}}
			>
				Show the Guide
			</Button>
		</section>
	);
}

/** Changes the visit's bound; the reading position is marked, never preselected. */
function BoundPicker({
	open,
	onOpenChange,
	units,
	current,
	mine,
	onChoose,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	units: ReadingUnit[];
	current: GuideBound | null;
	mine: GuideBound | null;
	onChoose: (bound: GuideBound) => void;
}) {
	const [choice, setChoice] = useState<Choice | null>(null);
	const chosen = choice === null ? null : toBound(choice, units);
	const unchanged =
		chosen !== null &&
		current !== null &&
		toChoice(chosen) === toChoice(current);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next);
				setChoice(null);
			}}
		>
			<DialogContent data-testid="guide-bound-dialog">
				<DialogHeader>
					<DialogTitle>Show the Guide through…</DialogTitle>
					<DialogDescription>
						For this visit only. Going past your reading position asks first,
						and your reading position does not change.
					</DialogDescription>
				</DialogHeader>
				<ScopeChoices
					units={units}
					value={choice}
					position={toChoice(mine)}
					legend="How far the Guide may show"
					onChange={setChoice}
				/>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button
						type="button"
						disabled={chosen === null || unchanged}
						onClick={() => {
							if (chosen) onChoose(chosen);
							setChoice(null);
						}}
					>
						Show
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
