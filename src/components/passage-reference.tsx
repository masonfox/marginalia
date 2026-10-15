import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronRight, Link2, MessageSquarePlus, Quote } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { NewConversationDialog, scopeText } from "#/components/scope";
import { listConversationsFn } from "#/fns/conversations";
import { type PassageRef, passageHref } from "#/lib/passage-ref";
import { selectionToPassageRef } from "#/lib/passage-selection";

const itemClass =
	"flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-60 data-[highlighted]:bg-accent data-[state=open]:bg-accent";
const surfaceClass =
	"z-50 rounded-md border bg-popover p-1 font-sans text-popover-foreground shadow-md";
const contentClass = `${surfaceClass} min-w-56 max-w-80`;
/** Narrow screens leave little room beside the menu, so the list takes only what is free. */
const listClass = `${surfaceClass} max-h-72 w-max min-w-40 max-w-[min(20rem,var(--radix-dropdown-menu-content-available-width))] overflow-y-auto`;

interface MenuProps {
	passageRef: PassageRef;
	editionId: string;
	/** For limiting a new conversation's scope choices to units that include the passage. */
	revealPosition: number;
	aiEnabled: boolean;
	/** The trigger button. */
	children: ReactNode;
	/** Called while the menu, or something it opened, needs the trigger to stay. */
	onActiveChange?: (active: boolean) => void;
	defaultOpen?: boolean;
}

/**
 * Reference options for a passage or a selection in it: copy its link, and
 * with AI configured, discuss it in a new conversation or add it to one of the
 * book's conversations.
 */
export function PassageReferenceMenu({
	passageRef,
	editionId,
	revealPosition,
	aiEnabled,
	children,
	onActiveChange,
	defaultOpen,
}: MenuProps) {
	const navigate = useNavigate();
	const [menuOpen, setMenuOpen] = useState(defaultOpen ?? false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [listOpen, setListOpen] = useState(false);
	const [feedback, setFeedback] = useState("");
	const [fallback, setFallback] = useState<string | null>(null);
	const conversations = useQuery({
		queryKey: ["conversations", editionId],
		queryFn: () => listConversationsFn({ data: { editionId } }),
		enabled: listOpen,
	});
	const active = menuOpen || dialogOpen || fallback !== null;
	useEffect(() => onActiveChange?.(active), [active, onActiveChange]);
	const hl = passageRef.range
		? `${passageRef.range.start}-${passageRef.range.end}`
		: undefined;

	const copy = async () => {
		const url = new URL(passageHref(passageRef), window.location.origin).href;
		try {
			if (!navigator.clipboard) throw new Error("no clipboard");
			await navigator.clipboard.writeText(url);
			setFallback(null);
			setFeedback("Link copied.");
		} catch {
			// Plain HTTP has no clipboard API: let the reader copy it by hand.
			setFallback(url);
			setFeedback("Copy the link from the box below.");
		}
	};

	return (
		<>
			<DropdownMenu.Root
				modal={false}
				defaultOpen={defaultOpen}
				onOpenChange={(open) => {
					setMenuOpen(open);
					if (open) setFeedback("");
				}}
			>
				<DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
				<DropdownMenu.Content
					className={contentClass}
					align="end"
					sideOffset={4}
					collisionPadding={8}
				>
					<DropdownMenu.Item className={itemClass} onSelect={() => void copy()}>
						<Link2 className="size-4" aria-hidden />
						Copy link
					</DropdownMenu.Item>
					{aiEnabled && (
						<>
							<DropdownMenu.Item
								className={itemClass}
								onSelect={() => setDialogOpen(true)}
							>
								<MessageSquarePlus className="size-4" aria-hidden />
								Discuss in a new conversation
							</DropdownMenu.Item>
							<DropdownMenu.Sub onOpenChange={setListOpen}>
								<DropdownMenu.SubTrigger className={itemClass}>
									<Quote className="size-4" aria-hidden />
									<span className="flex-1">Add to a conversation</span>
									<ChevronRight className="size-4" aria-hidden />
								</DropdownMenu.SubTrigger>
								<DropdownMenu.SubContent
									className={listClass}
									sideOffset={4}
									collisionPadding={8}
								>
									{conversations.isPending ? (
										<DropdownMenu.Item className={itemClass} disabled>
											Loading conversations…
										</DropdownMenu.Item>
									) : conversations.isError ? (
										<DropdownMenu.Item className={itemClass} disabled>
											Could not load conversations.
										</DropdownMenu.Item>
									) : conversations.data.length === 0 ? (
										<DropdownMenu.Item className={itemClass} disabled>
											No conversations about this book yet.
										</DropdownMenu.Item>
									) : (
										conversations.data.map((c) => (
											<DropdownMenu.Item
												key={c.id}
												className={cn(itemClass, "flex-col items-start gap-0")}
												onSelect={() =>
													void navigate({
														to: "/c/$conversationId",
														params: { conversationId: c.id },
														search: { ref: passageRef.locator, hl },
													})
												}
											>
												<span className="line-clamp-2">{c.title}</span>
												<span className="text-xs text-muted-foreground">
													{scopeText(c.scopeLabel)}
												</span>
											</DropdownMenu.Item>
										))
									)}
								</DropdownMenu.SubContent>
							</DropdownMenu.Sub>
						</>
					)}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{/* Mounted on demand: the passage view has a menu for every passage. */}
			{aiEnabled && dialogOpen && (
				<NewConversationDialog
					editionId={editionId}
					passage={{ ref: passageRef, revealPosition }}
					open={dialogOpen}
					onOpenChange={setDialogOpen}
				/>
			)}
			{fallback !== null && (
				<input
					readOnly
					value={fallback}
					aria-label="Passage link"
					// biome-ignore lint/a11y/noAutofocus: shown in answer to the reader's copy request
					autoFocus
					onFocus={(e) => e.currentTarget.select()}
					onBlur={() => setFallback(null)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setFallback(null);
					}}
					className="mt-1 block w-full rounded-md border bg-background px-2 py-1 font-sans text-xs"
				/>
			)}
			<output aria-live="polite" className="sr-only">
				{feedback}
			</output>
		</>
	);
}

/**
 * The per-passage reference button, floating in the gutter left of the text.
 * Shown on hover and focus, and always on touch screens, which have no hover.
 * The wrapper's right padding bridges the gap to the text, so moving the
 * pointer from the text to the button keeps the passage hovered.
 */
export function PassageReferenceButton(
	props: Omit<MenuProps, "children" | "onActiveChange">,
) {
	return (
		<span className="absolute top-0 right-full pr-3 font-sans select-none">
			<PassageReferenceMenu {...props}>
				<button
					type="button"
					aria-label="Reference this passage"
					className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
				>
					<Link2 className="size-5" aria-hidden />
				</button>
			</PassageReferenceMenu>
		</span>
	);
}

/**
 * A floating reference action for a selection inside one passage's text.
 * Escape or clearing the selection dismisses it; it stays while its menu or
 * a dialog it opened is in use.
 */
export function PassageSelectionAction({
	passages,
	editionId,
	aiEnabled,
}: {
	/** Reveal positions by locator, for the passages on the page. */
	passages: Map<string, number>;
	editionId: string;
	aiEnabled: boolean;
}) {
	const [snapshot, setSnapshot] = useState<{
		ref: PassageRef;
		left: number;
		top: number;
	} | null>(null);
	const active = useRef(false);
	const button = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const update = () => {
			if (active.current) return;
			const selection = window.getSelection();
			const ref = selectionToPassageRef(selection);
			if (!ref || !selection) {
				setSnapshot(null);
				return;
			}
			const rect = selection.getRangeAt(0).getBoundingClientRect();
			setSnapshot({
				ref,
				left: Math.max(8, Math.min(rect.left, window.innerWidth - 200)),
				// Above the selection like a native menu; below only when there is no room.
				top:
					rect.top >= 56
						? rect.top - 48
						: Math.min(rect.bottom + 8, window.innerHeight - 48),
			});
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !active.current) setSnapshot(null);
			// Move focus straight to the action, as the reply selection does.
			if (
				event.key === "Tab" &&
				!event.shiftKey &&
				!active.current &&
				button.current &&
				document.activeElement !== button.current &&
				selectionToPassageRef(window.getSelection())
			) {
				event.preventDefault();
				button.current.focus();
			}
		};
		document.addEventListener("selectionchange", update);
		document.addEventListener("pointerup", update);
		document.addEventListener("touchend", update);
		document.addEventListener("keydown", key);
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);
		return () => {
			document.removeEventListener("selectionchange", update);
			document.removeEventListener("pointerup", update);
			document.removeEventListener("touchend", update);
			document.removeEventListener("keydown", key);
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
		};
	}, []);
	if (!snapshot) return null;
	const revealPosition = passages.get(snapshot.ref.locator);
	if (revealPosition === undefined) return null;
	return (
		<div
			className="fixed z-50 max-w-80"
			style={{ left: snapshot.left, top: snapshot.top }}
		>
			<PassageReferenceMenu
				passageRef={snapshot.ref}
				editionId={editionId}
				revealPosition={revealPosition}
				aiEnabled={aiEnabled}
				onActiveChange={(next) => {
					active.current = next;
				}}
			>
				<button
					ref={button}
					type="button"
					// Hold the selection's snapshot while the menu opens, whatever selection events follow.
					onPointerDown={() => {
						active.current = true;
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ")
							active.current = true;
					}}
					className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground shadow-lg ring-2 ring-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				>
					<Link2 className="size-4" aria-hidden />
					Reference selection
				</button>
			</PassageReferenceMenu>
		</div>
	);
}
