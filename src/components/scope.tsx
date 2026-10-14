import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "cn";
import { BookOpenCheck, ChevronDown, TriangleAlert } from "lucide-react";
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

/**
 * The numbers of labels that are all the same word followed by a number
 * ("Chapter 1", "Chapter 2", …), or null when any label is not.
 */
function numbering(labels: string[]) {
	let prefix: string | undefined;
	const numbers: string[] = [];
	for (const label of labels) {
		const match = /^(\D*?)\s*(\d+)$/.exec(label);
		if (!match || (prefix !== undefined && match[1] !== prefix)) return null;
		prefix = match[1];
		numbers.push(match[2] as string);
	}
	return numbers;
}

const optionClass =
	"relative cursor-pointer rounded-md text-sm transition-colors hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:checked]:bg-primary has-[:checked]:font-medium has-[:checked]:text-primary-foreground";

/** A choice whose radio is a transparent overlay, so its label shows the state. */
function Option({
	choice,
	label,
	value,
	onChange,
	read,
	className,
	children,
}: {
	choice: Choice;
	/** Accessible name, when it differs from what is shown. */
	label: string;
	value: Choice | null;
	onChange: (choice: Choice) => void;
	/** Shade as read: at or before the chosen unit. */
	read?: boolean;
	className?: string;
	children: ReactNode;
}) {
	return (
		<label
			title={label}
			className={cn(
				optionClass,
				read && "bg-accent/60 text-foreground",
				className,
			)}
		>
			<input
				type="radio"
				name="scope"
				className="absolute inset-0 cursor-pointer appearance-none opacity-0"
				value={choice}
				aria-label={label}
				checked={value === choice}
				onChange={() => onChange(choice)}
			/>
			{children}
		</label>
	);
}

/**
 * "Whole book", then a collapsed "partway through" section that opens to the
 * units grouped by parent, shown as a grid of numbers when a group is plainly
 * numbered. Units up to the chosen one are shaded as read. Nothing is
 * preselected.
 */
function ScopeChoices({
	units,
	value,
	onChange,
}: {
	units: ReadingUnit[];
	value: Choice | null;
	onChange: (choice: Choice) => void;
}) {
	const chosenEnd =
		value === null
			? -1
			: value === "whole"
				? Number.POSITIVE_INFINITY
				: Number(value.slice(5));
	const shared = { value, onChange };
	const [expanded, setExpanded] = useState(false);
	const chosen = units.find((u) => `unit:${u.endPosition}` === value);
	return (
		<fieldset className="space-y-3">
			<legend className="sr-only">How far you have read</legend>
			<Option
				{...shared}
				choice="whole"
				label="Whole book"
				className="flex flex-col border px-3 py-2"
			>
				<span>Whole book</span>
				<span className="text-xs font-normal opacity-70">
					I've finished it. Later events are fair game.
				</span>
			</Option>
			{units.length > 0 && (
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls="scope-units"
					onClick={() => setExpanded((e) => !e)}
					className={cn(
						"flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						chosen && "border-primary",
					)}
				>
					<span className="flex flex-1 flex-col">
						<span>I'm partway through</span>
						<span className="text-xs text-muted-foreground">
							{chosen
								? `Through ${chosen.label}`
								: "Choose the last chapter you finished."}
						</span>
					</span>
					<ChevronDown
						className={cn(
							"size-4 shrink-0 text-muted-foreground transition-transform",
							expanded && "rotate-180",
						)}
						aria-hidden
					/>
				</button>
			)}
			{units.length > 0 && expanded && (
				<div
					id="scope-units"
					className="max-h-[40vh] overflow-y-auto rounded-md border"
				>
					{groupUnits(units).map((group) => {
						const short = (u: ReadingUnit) =>
							group.parent ? u.label.slice(group.parent.length + 3) : u.label;
						const numbers = numbering(group.units.map(short));
						return (
							<div key={`${group.parent}:${group.units[0]?.ordinal}`}>
								{group.parent && (
									<p className="sticky top-0 z-10 border-b bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
										{group.parent}
									</p>
								)}
								<div
									className={
										numbers
											? "grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1 p-2"
											: "space-y-0.5 p-1"
									}
								>
									{group.units.map((u, i) => (
										<Option
											{...shared}
											key={u.endPosition}
											choice={`unit:${u.endPosition}`}
											label={short(u)}
											read={u.endPosition <= chosenEnd}
											className={
												numbers
													? "flex h-9 items-center justify-center tabular-nums"
													: "block px-3 py-1.5"
											}
										>
											{numbers ? numbers[i] : short(u)}
										</Option>
									))}
								</div>
							</div>
						);
					})}
				</div>
			)}
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
