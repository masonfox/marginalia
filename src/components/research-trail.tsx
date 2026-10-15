import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Check,
	ChevronRight,
	CircleSlash,
	Copy,
	Loader2,
	PencilLine,
	TriangleAlert,
	UserPen,
} from "lucide-react";
import { Collapsible } from "radix-ui";
import { createContext, useContext, useState } from "react";
import {
	type CorrectableItem,
	CorrectionDialog,
} from "#/components/corrections";
import { getGuideStepFn, getTrailObservationsFn } from "#/fns/conversations";
import {
	describeStep,
	type GuideContextLike,
	type Step,
	type StepPassage,
	type StepStatus,
	summarizeTrail,
	type ToolPartLike,
} from "#/lib/research-trail";
import { useToolDetails } from "#/lib/tool-details";

const SNIPPET_CHARS = 200;
const RAW_CHARS = 4000;

/** The conversation a trail belongs to, for reading the guide again and linking notes. */
export interface TrailContext {
	conversationId: string;
	/** The conversation's books still in the library, by their handle's ordinal. */
	books: { editionId: string; ordinal: number; title: string }[];
}

const TrailContextValue = createContext<TrailContext | null>(null);

/** The conversation book a lookup's handle (b1, b2, …) names, if it is still there. */
const bookOf = (context: TrailContext | null, handle: string | undefined) =>
	context?.books.find((b) => `b${b.ordinal + 1}` === handle?.toLowerCase());

/**
 * Tool activity for one run of consecutive tool calls, after any `leading`
 * steps (a reply's guide steps). Open by default only while the reply has
 * not started; the reader's own toggle always wins.
 */
export function ResearchTrail({
	parts,
	leading = [],
	context = null,
	hasReply,
	streaming,
}: {
	parts: ToolPartLike[];
	/** Steps shown before the tool calls, such as the guide steps. */
	leading?: Step[];
	context?: TrailContext | null;
	/** Whether the message has any reply text yet. */
	hasReply: boolean;
	/** Whether this message is still being generated. */
	streaming: boolean;
}) {
	const steps = [...leading, ...parts.map(describeStep)];
	const [chosen, setChosen] = useState<boolean | null>(null);
	const [showAll, setShowAll] = useToolDetails();
	const derived =
		!hasReply && (streaming || steps.some((s) => s.status === "running"));
	const open = chosen ?? derived;
	return (
		<TrailContextValue.Provider value={context}>
			<Collapsible.Root
				open={open}
				onOpenChange={setChosen}
				className="border-l-2 pl-3 text-xs text-muted-foreground"
				data-testid="research-trail"
			>
				<Collapsible.Trigger className="flex cursor-pointer items-center gap-1 rounded-sm py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
					<ChevronRight
						className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
						aria-hidden
					/>
					{summarizeTrail(steps)}
				</Collapsible.Trigger>
				<Collapsible.Content>
					<ul className="mt-1 space-y-1.5">
						{steps.map((step, i) => (
							// Steps are append-only, so the index is a stable key.
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only list
							<StepRow key={i} step={step} showRaw={showAll} />
						))}
					</ul>
					<label className="mt-2 flex w-fit cursor-pointer items-center gap-1.5">
						<input
							type="checkbox"
							checked={showAll}
							onChange={(e) => setShowAll(e.target.checked)}
						/>
						Show tool details
					</label>
				</Collapsible.Content>
			</Collapsible.Root>
		</TrailContextValue.Provider>
	);
}

function StatusIcon({ status }: { status: StepStatus }) {
	const cls = "size-3.5 shrink-0";
	switch (status) {
		case "running":
			return (
				<Loader2 className={`${cls} animate-spin`} aria-label="In progress" />
			);
		case "failed":
			return <TriangleAlert className={cls} aria-label="Failed" />;
		case "unavailable":
			return <CircleSlash className={cls} aria-label="Unavailable" />;
		case "empty":
			return <CircleSlash className={cls} aria-label="No matches" />;
		default:
			return <Check className={cls} aria-label="Done" />;
	}
}

function StepRow({ step, showRaw }: { step: Step; showRaw: boolean }) {
	const [open, setOpen] = useState(false);
	const [rawChosen, setRawChosen] = useState<boolean | null>(null);
	const raw = rawChosen ?? showRaw;
	const expandable =
		step.passages.length > 0 ||
		(step.observations?.length ?? 0) > 0 ||
		(step.notes?.length ?? 0) > 0 ||
		step.guide !== undefined;
	const header = (
		<>
			<StatusIcon status={step.status} />
			<span className="min-w-0 break-words text-left">{step.label}</span>
			{step.detail && (
				<span
					className={
						step.status === "failed" || step.status === "unavailable"
							? "text-destructive-foreground"
							: "opacity-80"
					}
				>
					· {step.detail}
				</span>
			)}
		</>
	);
	return (
		<li>
			<Collapsible.Root open={open} onOpenChange={setOpen}>
				<div className="flex flex-wrap items-center gap-x-1.5">
					{expandable ? (
						<Collapsible.Trigger className="flex cursor-pointer items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
							{header}
						</Collapsible.Trigger>
					) : (
						<span className="flex items-center gap-1.5">{header}</span>
					)}
					<button
						type="button"
						aria-pressed={raw}
						onClick={() => setRawChosen(!raw)}
						className="ml-auto cursor-pointer rounded-sm px-1 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
					>
						Raw
					</button>
				</div>
				<Collapsible.Content>
					{step.guide ? (
						<GuideStepDetails guide={step.guide} />
					) : step.observations ? (
						<ObservationList step={step} />
					) : step.notes ? (
						<NoteList step={step} />
					) : (
						<PassageList passages={step.passages} />
					)}
				</Collapsible.Content>
				{raw && <RawData raw={step.raw} />}
			</Collapsible.Root>
		</li>
	);
}

/** Opens the shared correction flow for one summary or observation of the trail. */
function CorrectThis({
	item,
	onChanged,
}: {
	item: CorrectableItem;
	onChanged: () => void | Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="inline-flex cursor-pointer items-center gap-1 rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
				data-testid="trail-correct-this"
			>
				<PencilLine className="size-3" aria-hidden />
				{item.correction ? "Edit correction" : "Correct this"}
			</button>
			<CorrectionDialog
				open={open}
				onOpenChange={setOpen}
				item={item}
				onChanged={onChanged}
			/>
		</>
	);
}

/** Marks a trail item the reader corrected. */
function CorrectedMark() {
	return (
		<span
			className="inline-flex items-center gap-1 rounded-sm border px-1 text-[0.65rem]"
			title="You replaced the generated text."
			data-testid="trail-corrected"
		>
			<UserPen className="size-3" aria-hidden />
			Corrected by reader
		</span>
	);
}

/**
 * A guide step expanded: the summaries now within the scope the reply
 * recorded, with corrections applied, each correctable while its book is
 * still in the library. Says when the guide changed since the reply.
 */
function GuideStepDetails({ guide }: { guide: GuideContextLike }) {
	const context = useContext(TrailContextValue);
	const queryClient = useQueryClient();
	const present = context?.books.some((b) => b.editionId === guide.editionId);
	const step = useQuery({
		queryKey: ["guide-step", context?.conversationId, guide],
		queryFn: () =>
			getGuideStepFn({
				data: {
					conversationId: context?.conversationId ?? "",
					editionId: guide.editionId,
					maxPosition: guide.maxPosition,
					mapFingerprint: guide.mapFingerprint,
				},
			}),
		enabled: !!context && !!present,
	});
	if (!context || !present || step.data?.status === "gone")
		return <p className="mt-1 ml-5">This book is no longer in your library.</p>;
	if (step.isError)
		return <p className="mt-1 ml-5">Could not load the summaries.</p>;
	if (!step.data) return <p className="mt-1 ml-5">Loading…</p>;
	const refresh = async () => {
		await step.refetch();
		await queryClient.invalidateQueries({
			queryKey: ["guide", guide.editionId],
		});
	};
	return (
		<div className="mt-1 ml-5 space-y-2" data-testid="guide-step">
			{step.data.changed && (
				<p
					className="flex items-center gap-1 text-amber-700 dark:text-amber-400"
					data-testid="guide-changed"
				>
					<TriangleAlert className="size-3" aria-hidden />
					The guide has changed since this reply.
				</p>
			)}
			<ul className="space-y-2">
				{step.data.summaries.map((s) => (
					<li key={s.unitLocator}>
						<p className="flex flex-wrap items-center gap-x-2">
							<span className="font-medium text-foreground">{s.unitLabel}</span>
							{s.correction?.action === "replace" && <CorrectedMark />}
						</p>
						<p>{s.summary}</p>
						<CorrectThis
							item={{
								editionId: guide.editionId,
								unitLocator: s.unitLocator,
								unitLabel: s.unitLabel,
								observation: null,
								generated: s.generated,
								correction: s.correction,
							}}
							onChanged={refresh}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * An observation lookup expanded: what the reply received, unchanged, with
 * "Correct this" on each item whose row is still current.
 */
function ObservationList({ step }: { step: Step }) {
	const context = useContext(TrailContextValue);
	const queryClient = useQueryClient();
	const book = bookOf(context, step.book);
	const observations = step.observations ?? [];
	const items = observations.map((o) => ({
		unitLabel: o.unitLabel,
		observedAs: o.observedAs,
	}));
	const current = useQuery({
		queryKey: [
			"trail-observations",
			context?.conversationId,
			book?.editionId,
			step.lookedUp,
			items,
		],
		queryFn: () =>
			getTrailObservationsFn({
				data: {
					conversationId: context?.conversationId ?? "",
					editionId: book?.editionId ?? "",
					name: step.lookedUp ?? "",
					items,
				},
			}),
		enabled: !!context && !!book && !!step.lookedUp,
	});
	const refresh = async () => {
		await current.refetch();
		if (book)
			await queryClient.invalidateQueries({
				queryKey: ["guide", book.editionId],
			});
	};
	const lookedUp = step.lookedUp?.toLowerCase();
	return (
		<ul className="mt-1 ml-5 space-y-2" data-testid="trail-observations">
			{observations.map((o, i) => {
				const row = current.data?.[i];
				return (
					// Stored results never change, so the index is a stable key.
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed list
					<li key={i}>
						<p className="flex flex-wrap items-center gap-x-2">
							<span className="font-medium text-foreground">{o.unitLabel}</span>
							{o.observedAs && o.observedAs.toLowerCase() !== lookedUp && (
								<span>as “{o.observedAs}”</span>
							)}
							{o.corrected && <CorrectedMark />}
						</p>
						<p>{o.note}</p>
						{row && book && (
							<CorrectThis
								item={{
									editionId: book.editionId,
									unitLocator: row.unitLocator,
									unitLabel: row.unitLabel,
									observation: { nameKey: row.nameKey, name: row.name },
									generated: row.generated,
									correction: row.correction,
								}}
								onChanged={refresh}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** A notes lookup expanded: each note's title, linked to the note while its book remains. */
function NoteList({ step }: { step: Step }) {
	const book = bookOf(useContext(TrailContextValue), step.book);
	return (
		<ul className="mt-1 ml-5 space-y-1" data-testid="trail-notes">
			{(step.notes ?? []).map((n) => (
				<li key={n.id}>
					{book ? (
						<Link
							to="/books/$editionId/guide/notes/$noteId"
							params={{ editionId: book.editionId, noteId: String(n.id) }}
							className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
						>
							{n.title} →
						</Link>
					) : (
						n.title
					)}
				</li>
			))}
		</ul>
	);
}

function PassageList({ passages }: { passages: StepPassage[] }) {
	const multiBook = new Set(passages.map((p) => p.bookTitle)).size > 1;
	return (
		<ul className="mt-1 ml-5 space-y-2">
			{passages.map((p) => (
				<PassageItem key={p.locator} passage={p} showBook={multiBook} />
			))}
		</ul>
	);
}

function PassageItem({
	passage,
	showBook,
}: {
	passage: StepPassage;
	showBook: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const long = passage.text.length > SNIPPET_CHARS;
	const where = [showBook ? passage.bookTitle : undefined, passage.section]
		.filter(Boolean)
		.join(" · ");
	return (
		<li>
			<Link
				to="/p/$locator"
				params={{ locator: passage.locator }}
				className="block rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
			>
				<span
					className={`block font-serif italic ${expanded ? "" : "line-clamp-3"}`}
				>
					{passage.text || "(no text)"}
				</span>
				<span className="text-[0.7rem] opacity-80">
					{where ? `${where} · ` : ""}open in book →
				</span>
			</Link>
			{long && (
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="cursor-pointer text-[0.7rem] underline underline-offset-2"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</li>
	);
}

function RawData({ raw }: { raw: Step["raw"] }) {
	const [all, setAll] = useState(false);
	const [copied, setCopied] = useState(false);
	const text = JSON.stringify(raw, null, 2) ?? "";
	const shown = all ? text : text.slice(0, RAW_CHARS);
	const canCopy =
		typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;
	return (
		<div className="mt-1 ml-5">
			<pre className="whitespace-pre-wrap break-words rounded bg-muted p-2 text-[0.7rem]">
				{shown}
			</pre>
			<div className="mt-0.5 flex gap-2">
				{text.length > RAW_CHARS && (
					<button
						type="button"
						onClick={() => setAll(!all)}
						className="cursor-pointer underline underline-offset-2"
					>
						{all ? "Show less" : "Show more"}
					</button>
				)}
				{canCopy && (
					<button
						type="button"
						onClick={() => {
							navigator.clipboard.writeText(text).then(
								() => {
									setCopied(true);
									setTimeout(() => setCopied(false), 1500);
								},
								() => {},
							);
						}}
						className="inline-flex cursor-pointer items-center gap-1 underline underline-offset-2"
					>
						<Copy className="size-3" aria-hidden />
						{copied ? "Copied" : "Copy"}
					</button>
				)}
			</div>
		</div>
	);
}
