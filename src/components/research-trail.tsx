import { Link } from "@tanstack/react-router";
import {
	Check,
	ChevronRight,
	CircleSlash,
	Copy,
	Loader2,
	TriangleAlert,
} from "lucide-react";
import { Collapsible } from "radix-ui";
import { useState } from "react";
import {
	describeStep,
	type Step,
	type StepPassage,
	type StepStatus,
	summarizeTrail,
	type ToolPartLike,
} from "#/lib/research-trail";
import { useToolDetails } from "#/lib/tool-details";

const SNIPPET_CHARS = 200;
const RAW_CHARS = 4000;

/**
 * Tool activity for one run of consecutive tool calls. Open by default only while
 * the reply has not started; the reader's own toggle always wins.
 */
export function ResearchTrail({
	parts,
	hasReply,
	streaming,
}: {
	parts: ToolPartLike[];
	/** Whether the message has any reply text yet. */
	hasReply: boolean;
	/** Whether this message is still being generated. */
	streaming: boolean;
}) {
	const steps = parts.map(describeStep);
	const [chosen, setChosen] = useState<boolean | null>(null);
	const [showAll, setShowAll] = useToolDetails();
	const derived =
		!hasReply && (streaming || steps.some((s) => s.status === "running"));
	const open = chosen ?? derived;
	return (
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
	const expandable = step.passages.length > 0;
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
					<PassageList passages={step.passages} />
				</Collapsible.Content>
				{raw && <RawData raw={step.raw} />}
			</Collapsible.Root>
		</li>
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
