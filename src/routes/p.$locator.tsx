import {
	createFileRoute,
	Link,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { z } from "zod";
import {
	PassageReferenceButton,
	PassageSelectionAction,
} from "#/components/passage-reference";
import { PassageText } from "#/components/passage-text";
import { getAiStatusFn } from "#/fns/conversations";
import { getSectionViewFn } from "#/fns/retrieval";
import { parseHighlight } from "#/lib/citations";
import type { SectionPassage, SectionView } from "#/modules/retrieval";

export const Route = createFileRoute("/p/$locator")({
	validateSearch: z.object({ hl: z.string().max(20).optional() }),
	loader: async ({ params }) => {
		const [view, ai] = await Promise.all([
			getSectionViewFn({ data: { locator: params.locator } }),
			getAiStatusFn(),
		]);
		// Locators from an earlier parse forward to the passage that holds their text now.
		if (view.status === "found" && view.superseded) {
			throw redirect({
				to: "/p/$locator",
				params: { locator: view.currentLocator },
				replace: true,
			});
		}
		return { view, aiEnabled: ai.enabled };
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title:
					loaderData?.view.status === "found"
						? `${loaderData.view.section.title ?? loaderData.view.edition.title} · Marginalia`
						: "Passage · Marginalia",
			},
		],
	}),
	component: PassagePage,
});

function PassagePage() {
	const { view, aiEnabled } = Route.useLoaderData();
	const { hl } = Route.useSearch();

	if (view.status === "not_found") {
		return (
			<main className="mx-auto max-w-2xl px-4 py-10">
				<h1 className="font-serif text-2xl font-semibold">Passage not found</h1>
				<p className="mt-2 text-muted-foreground">
					No passage has the locator{" "}
					<code className="text-xs">{view.requestedLocator}</code>.
				</p>
			</main>
		);
	}
	if (view.status === "removed") {
		return (
			<main className="mx-auto max-w-2xl px-4 py-10">
				<h1 className="font-serif text-2xl font-semibold">
					Passage moved or removed
				</h1>
				<p className="mt-2 text-muted-foreground">
					This passage was moved or removed in a newer parse of{" "}
					<em>{view.edition.title}</em>.
				</p>
				<p className="mt-4">
					<Link
						to="/books/$editionId"
						params={{ editionId: view.edition.id }}
						className="underline"
					>
						Browse the book's table of contents
					</Link>
				</p>
			</main>
		);
	}
	return (
		<SectionText view={view} range={parseHighlight(hl)} aiEnabled={aiEnabled} />
	);
}

type FoundView = Extract<SectionView, { status: "found" }>;

function SectionText({
	view,
	range,
	aiEnabled,
}: {
	view: FoundView;
	range: { start: number; end: number } | null;
	aiEnabled: boolean;
}) {
	const target = view.currentLocator;
	const router = useRouter();
	const revealPositions = useMemo(
		() => new Map(view.passages.map((p) => [p.locator, p.revealPosition])),
		[view.passages],
	);
	useEffect(() => {
		document.getElementById(domId(target))?.scrollIntoView({ block: "center" });
	}, [target]);
	// Scroll restoration resets the window to the top on `onRendered`, after this
	// component's effects run, so scroll to the highlight again once it has.
	useEffect(() => router.subscribe("onRendered", scrollToHighlight), [router]);

	return (
		<main className="mx-auto max-w-3xl px-4 py-8">
			<nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
				<Link
					to="/books/$editionId"
					params={{ editionId: view.edition.id }}
					className="hover:underline"
				>
					{view.edition.title}
				</Link>
				{view.tocPath.map((label, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: TOC labels can repeat
					<span key={i}> / {label}</span>
				))}
			</nav>
			<p className="mt-1 text-xs text-muted-foreground">
				Position {view.position}
				{!view.section.linear && " · outside the main reading order"}
			</p>

			<SectionNav view={view} />

			<PassageSelectionAction
				passages={revealPositions}
				editionId={view.edition.id}
				aiEnabled={aiEnabled}
			/>
			<article className="mt-6 font-serif text-lg leading-relaxed">
				{view.passages.map((p) => (
					<PassageBlock
						key={p.locator}
						passage={p}
						editionId={view.edition.id}
						aiEnabled={aiEnabled}
						highlighted={p.locator === target}
						range={p.locator === target ? range : null}
					/>
				))}
			</article>

			<SectionNav view={view} />
		</main>
	);
}

function SectionNav({ view }: { view: FoundView }) {
	return (
		<div className="mt-6 flex justify-between gap-4 text-sm">
			{view.previous ? (
				<Link
					to="/p/$locator"
					params={{ locator: view.previous.locator }}
					className="hover:underline"
				>
					← {view.previous.title ?? "Previous section"}
				</Link>
			) : (
				<span />
			)}
			{view.next && (
				<Link
					to="/p/$locator"
					params={{ locator: view.next.locator }}
					className="text-right hover:underline"
				>
					{view.next.title ?? "Next section"} →
				</Link>
			)}
		</div>
	);
}

function scrollToHighlight() {
	document
		.querySelector('[data-locator][aria-current="true"]')
		?.scrollIntoView({ block: "center" });
}

function domId(locator: string) {
	return `passage-${locator.replace(/[^a-z0-9]/gi, "-")}`;
}

function PassageBlock({
	passage,
	editionId,
	aiEnabled,
	highlighted,
	range,
}: {
	passage: SectionPassage;
	editionId: string;
	aiEnabled: boolean;
	highlighted: boolean;
	range: { start: number; end: number } | null;
}) {
	const className = [
		// Right padding leaves room for the reference button.
		"group relative my-3 scroll-mt-24 whitespace-pre-line rounded-sm",
		highlighted ? "-mx-2 bg-highlight py-1 pr-11 pl-2" : "pr-9",
		passage.kind === "heading" ? "font-sans text-xl font-semibold" : "",
		passage.kind === "quote" ? "border-l-2 pl-4 italic" : "",
		passage.kind === "footnote" ? "text-base text-muted-foreground" : "",
		passage.kind === "preformatted" ? "whitespace-pre font-mono text-sm" : "",
	].join(" ");
	return (
		<div
			id={domId(passage.locator)}
			data-locator={passage.locator}
			className={className}
			aria-current={highlighted ? "true" : undefined}
		>
			<PassageText
				locator={passage.locator}
				text={passage.text}
				range={range}
			/>
			<PassageReferenceButton
				passageRef={{ locator: passage.locator }}
				editionId={editionId}
				revealPosition={passage.revealPosition}
				aiEnabled={aiEnabled}
			/>
			{passage.notes.length > 0 && (
				<div className="mt-1 space-y-1 font-sans text-sm">
					{passage.notes.map((note, i) => (
						<details
							key={note.locator}
							className="rounded-md border bg-muted/40 px-3 py-1"
						>
							<summary className="cursor-pointer text-muted-foreground">
								Note {i + 1}
							</summary>
							<p className="mt-1 whitespace-pre-line">{note.text}</p>
							<Link
								to="/p/$locator"
								params={{ locator: note.locator }}
								className="text-xs underline"
							>
								Open note in context
							</Link>
						</details>
					))}
				</div>
			)}
		</div>
	);
}
