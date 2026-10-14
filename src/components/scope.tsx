import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookOpenCheck, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import {
	createConversationFn,
	getReadingUnitsFn,
	widenScopeFn,
} from "#/fns/conversations";
import type { ReadingUnit } from "#/modules/catalog";
import type { ConversationBook, Scope } from "#/modules/conversation";

/** "Through Chapter 22" or "Whole book". */
export const scopeText = (label: string | null) =>
	label === null ? "Whole book" : `Through ${label}`;

type Choice = "whole" | `unit:${number}`;

const toScope = (choice: Choice): Scope =>
	choice === "whole"
		? { kind: "whole" }
		: { kind: "unit", endPosition: Number(choice.slice(5)) };

const STALE =
	"This book's chapters changed since the list was loaded. Please choose again.";

/** Consecutive units sharing a parent path, for grouped display. */
function groupUnits(units: ReadingUnit[]) {
	const groups: { parent: string; units: ReadingUnit[] }[] = [];
	for (const unit of units) {
		const parent = unit.path.slice(0, -1).join(" › ");
		const last = groups.at(-1);
		if (last && last.parent === parent) last.units.push(unit);
		else groups.push({ parent, units: [unit] });
	}
	return groups;
}

/** Radio choices: the units grouped by parent, then "Whole book". Nothing is preselected. */
function ScopeChoices({
	units,
	value,
	onChange,
}: {
	units: ReadingUnit[];
	value: Choice | null;
	onChange: (choice: Choice) => void;
}) {
	const option = (choice: Choice, label: string) => (
		<label
			key={choice}
			className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/50"
		>
			<input
				type="radio"
				name="scope"
				value={choice}
				checked={value === choice}
				onChange={() => onChange(choice)}
			/>
			{label}
		</label>
	);
	return (
		<fieldset className="max-h-[50vh] space-y-2 overflow-y-auto rounded-md border p-2">
			<legend className="sr-only">How far you have read</legend>
			{groupUnits(units).map((group) => (
				<div key={`${group.parent}:${group.units[0]?.ordinal}`}>
					{group.parent && (
						<p className="px-2 pt-1 text-xs font-medium text-muted-foreground">
							{group.parent}
						</p>
					)}
					{group.units.map((u) =>
						option(
							`unit:${u.endPosition}`,
							group.parent ? u.label.slice(group.parent.length + 3) : u.label,
						),
					)}
				</div>
			))}
			{option("whole", "Whole book")}
		</fieldset>
	);
}

/**
 * What the assistant may reveal: a spoiler warning when any book is whole
 * book, otherwise a note on the scope's limits.
 */
export function ScopeNotice({ labels }: { labels: (string | null)[] }) {
	if (labels.length === 0) return null;
	if (labels.some((l) => l === null)) {
		return (
			<p
				className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground"
				data-testid="spoiler-notice"
			>
				<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
				<span>
					The assistant has access to the whole book, so it may reveal later
					events.
				</span>
			</p>
		);
	}
	const through = labels.map((l) => `“${l}”`).join(", ");
	return (
		<p
			className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground"
			data-testid="scope-note"
		>
			<BookOpenCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
			<span>
				The assistant can read only through {through} and is told not to discuss
				later events, but it may still know the book from its training.
			</span>
		</p>
	);
}

/** Asks how far the reader has read, then starts a conversation and opens it. */
export function NewConversationDialog({
	editionId,
	children,
}: {
	editionId: string;
	/** The trigger button. */
	children: ReactNode;
}) {
	const navigate = useNavigate();
	const create = useServerFn(createConversationFn);
	const [open, setOpen] = useState(false);
	const [choice, setChoice] = useState<Choice | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const units = useQuery({
		queryKey: ["reading-units", editionId],
		queryFn: () => getReadingUnitsFn({ data: { editionId } }),
		enabled: open,
	});
	const chosenLabel =
		choice === null
			? undefined
			: choice === "whole"
				? null
				: (units.data?.find((u) => `unit:${u.endPosition}` === choice)?.label ??
					undefined);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) return;
				setOpen(next);
				setChoice(null);
				setError(null);
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent data-testid="new-conversation-dialog">
				<DialogHeader>
					<DialogTitle>How far have you read?</DialogTitle>
					<DialogDescription>
						The assistant will only read up to the point you choose. You can
						widen it later, but not narrow it.
					</DialogDescription>
				</DialogHeader>
				{units.isPending ? (
					<p className="text-sm text-muted-foreground">Loading chapters…</p>
				) : units.isError ? (
					<p className="text-sm text-destructive-foreground">
						Could not load this book's chapters.
					</p>
				) : (
					<ScopeChoices
						units={units.data}
						value={choice}
						onChange={(c) => {
							setChoice(c);
							setError(null);
						}}
					/>
				)}
				{chosenLabel !== undefined && <ScopeNotice labels={[chosenLabel]} />}
				{error && (
					<p role="alert" className="text-sm text-destructive-foreground">
						{error}
					</p>
				)}
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline" disabled={busy}>
							Cancel
						</Button>
					</DialogClose>
					<Button
						type="button"
						disabled={choice === null || busy}
						onClick={async () => {
							if (choice === null) return;
							setBusy(true);
							setError(null);
							try {
								const created = await create({
									data: { editionId, scope: toScope(choice) },
								});
								if (!created) {
									setError("This book is not ready for conversations yet.");
								} else if ("error" in created) {
									setChoice(null);
									setError(STALE);
									await units.refetch();
								} else {
									await navigate({
										to: "/c/$conversationId",
										params: { conversationId: created.id },
									});
									return;
								}
							} catch {
								setError("Could not start a conversation. Please try again.");
							}
							setBusy(false);
						}}
					>
						Start
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Lets the reader move a book's scope to a later unit or the whole book. */
export function WidenScope({
	conversationId,
	book,
	disabled,
}: {
	conversationId: string;
	book: ConversationBook;
	disabled: boolean;
}) {
	const router = useRouter();
	const widen = useServerFn(widenScopeFn);
	const [open, setOpen] = useState(false);
	const [choice, setChoice] = useState<Choice | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const units = useQuery({
		queryKey: ["reading-units", book.editionId],
		queryFn: () => getReadingUnitsFn({ data: { editionId: book.editionId } }),
		enabled: open,
	});
	if (book.maxPosition === null) return null;
	const bound = book.maxPosition;
	const later = units.data?.filter((u) => u.endPosition > bound) ?? [];

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) return;
				setOpen(next);
				setChoice(null);
				setError(null);
			}}
		>
			<DialogTrigger asChild>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					disabled={disabled}
					aria-label={`Widen scope of “${book.title}”`}
				>
					Widen
				</Button>
			</DialogTrigger>
			<DialogContent data-testid="widen-scope-dialog">
				<DialogHeader>
					<DialogTitle>How far have you read now?</DialogTitle>
					<DialogDescription>
						Currently through {book.scopeLabel}. Earlier replies may already
						discuss this far, so the scope can only move later.
					</DialogDescription>
				</DialogHeader>
				{units.isPending ? (
					<p className="text-sm text-muted-foreground">Loading chapters…</p>
				) : units.isError ? (
					<p className="text-sm text-destructive-foreground">
						Could not load this book's chapters.
					</p>
				) : (
					<ScopeChoices
						units={later}
						value={choice}
						onChange={(c) => {
							setChoice(c);
							setError(null);
						}}
					/>
				)}
				{error && (
					<p role="alert" className="text-sm text-destructive-foreground">
						{error}
					</p>
				)}
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline" disabled={busy}>
							Cancel
						</Button>
					</DialogClose>
					<Button
						type="button"
						disabled={choice === null || busy}
						onClick={async () => {
							if (choice === null) return;
							setBusy(true);
							setError(null);
							try {
								const result = await widen({
									data: {
										conversationId,
										editionId: book.editionId,
										scope: toScope(choice),
									},
								});
								if (result.widened || result.reason === "not_wider") {
									// not_wider: another tab already widened past this; show the current scope.
									await router.invalidate();
									setOpen(false);
									setChoice(null);
								} else if (result.reason === "stale_scope") {
									setChoice(null);
									setError(STALE);
									await units.refetch();
								} else {
									setError("This conversation no longer exists.");
								}
							} catch {
								setError("Could not widen the scope. Please try again.");
							}
							setBusy(false);
						}}
					>
						Widen
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
