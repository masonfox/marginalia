import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookMarked } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AiSetupNotice, modelInEffect } from "#/components/chat";
import { AutogrowTextarea } from "#/components/composer/autogrow-textarea";
import { SendButton } from "#/components/composer/send-button";
import { initialDraft, ModelChoice } from "#/components/model-picker";
import { MoveBackDialog, SHARED_POSITION } from "#/components/reading-position";
import {
	type Choice,
	positionChoice,
	ScopeChoices,
	ScopeNotice,
	STALE,
	scopeText,
	toScope,
} from "#/components/scope";
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
import { createConversationFn } from "#/fns/conversations";
import { useCoarsePointer } from "#/hooks/use-coarse-pointer";
import {
	readingPositionKey,
	readingUnitsKey,
	type SaveResult,
	useReadingPosition,
} from "#/hooks/use-reading-position";
import {
	bookDraftId,
	clearComposerDraft,
	loadComposerDraft,
	MESSAGE_LIMIT,
	saveComposerDraft,
} from "#/lib/composer-draft";
import type { ReadingUnit } from "#/modules/catalog";
import type { AiStatus } from "#/modules/settings";
import type { AiSelection } from "#/server/config";

/**
 * The scope the next conversation uses, as the strip shows it: still
 * loading, unset (ask how far), or a unit or the whole book, `once` when
 * chosen for this conversation only.
 */
export type StripState =
	| { kind: "loading" }
	| { kind: "unset" }
	| { kind: "unit"; label: string; once: boolean }
	| { kind: "whole"; once: boolean };

/**
 * Above the composer's input: the scope the next conversation will use with
 * what it means, or a question about how far the reader has read when no
 * position is set. `onChange` opens the scope choices.
 */
export function ScopeStrip({
	state,
	onChange,
	onUsePosition,
	disabled = false,
}: {
	state: StripState;
	onChange: () => void;
	/** Drops a scope chosen for this conversation only. */
	onUsePosition: () => void;
	disabled?: boolean;
}) {
	if (state.kind === "loading")
		return (
			<p
				className="text-sm text-muted-foreground"
				data-testid="composer-scope-strip"
				data-state="loading"
			>
				Loading your reading position…
			</p>
		);
	if (state.kind === "unset")
		return (
			<div
				className="flex flex-wrap items-center gap-2 text-sm"
				data-testid="composer-scope-strip"
				data-state="unset"
			>
				<BookMarked
					className="size-4 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<p className="min-w-0 flex-1">
					How far have you read? The assistant reads only that far, so it does
					not spoil what comes next.
				</p>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="pointer-coarse:h-11 pointer-coarse:min-w-11"
					disabled={disabled}
					onClick={onChange}
				>
					Choose
				</Button>
			</div>
		);
	const label = state.kind === "unit" ? state.label : null;
	return (
		<div
			className="space-y-2 text-sm"
			data-testid="composer-scope-strip"
			data-state={state.kind}
		>
			<div className="flex flex-wrap items-center gap-2">
				<BookMarked
					className="size-4 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<p className="min-w-0 flex-1 font-medium" data-testid="composer-scope">
					{scopeText(label)}
					{state.once && (
						<span className="font-normal text-muted-foreground">
							{" "}
							· this conversation only
						</span>
					)}
				</p>
				{state.once && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="pointer-coarse:h-11 pointer-coarse:min-w-11"
						disabled={disabled}
						onClick={onUsePosition}
					>
						Use my position
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="pointer-coarse:h-11 pointer-coarse:min-w-11"
					disabled={disabled}
					onClick={onChange}
				>
					Update
				</Button>
			</div>
			<ScopeNotice labels={[label]} />
		</div>
	);
}

/** Whether a choice from the sheet becomes the reading position or applies once. */
export type ScopeMode = "save" | "once";

/**
 * The composer's scope choices: the book's units with the reading position
 * marked, whether to save the choice as the reading position (the default)
 * or use it for this conversation only, and the shared-position caveat. A
 * bottom sheet on phones. Controlled: the parent holds the choice and mode.
 */
export function ScopeSheet({
	open,
	onOpenChange,
	units,
	unitsError = false,
	position,
	choice,
	onChoiceChange,
	mode,
	onModeChange,
	sending,
	busy,
	error,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Undefined while loading. */
	units: ReadingUnit[] | undefined;
	unitsError?: boolean;
	/** The choice matching the reading position, marked in the list. */
	position: Choice | null;
	choice: Choice | null;
	onChoiceChange: (choice: Choice) => void;
	mode: ScopeMode;
	onModeChange: (mode: ScopeMode) => void;
	/** Opened by sending: confirming also sends the message. */
	sending: boolean;
	busy: boolean;
	error: string | null;
	onConfirm: () => void;
}) {
	const name = useId();
	const chosenLabel =
		choice === null
			? undefined
			: choice === "whole"
				? null
				: (units?.find((u) => `unit:${u.endPosition}` === choice)?.label ??
					undefined);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) onOpenChange(next);
			}}
		>
			<DialogContent
				data-testid="composer-scope-sheet"
				className="max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[85dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none"
			>
				<DialogHeader>
					<DialogTitle>How far have you read?</DialogTitle>
					<DialogDescription>
						{sending
							? "Choose how far the assistant may read, then your question is sent."
							: "The next conversation reads only as far as you choose."}
					</DialogDescription>
				</DialogHeader>
				{units === undefined ? (
					unitsError ? (
						<p className="text-sm text-destructive-foreground">
							Could not load this book's chapters.
						</p>
					) : (
						<p className="text-sm text-muted-foreground">Loading chapters…</p>
					)
				) : (
					<ScopeChoices
						units={units}
						value={choice}
						position={position}
						onChange={onChoiceChange}
					/>
				)}
				{chosenLabel !== undefined && <ScopeNotice labels={[chosenLabel]} />}
				<fieldset className="space-y-1.5 text-sm">
					<legend className="sr-only">How to use this choice</legend>
					{(
						[
							["save", "Save as my reading position"],
							["once", "Only for this conversation"],
						] as const
					).map(([value, label]) => (
						<label
							key={value}
							className="flex items-center gap-2 pointer-coarse:min-h-11"
						>
							<input
								type="radio"
								name={name}
								value={value}
								checked={mode === value}
								onChange={() => onModeChange(value)}
								className="size-4 accent-primary"
							/>
							{label}
						</label>
					))}
					<p className="text-xs text-muted-foreground">{SHARED_POSITION}</p>
				</fieldset>
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
						onClick={onConfirm}
					>
						{sending ? "Send" : "Use this scope"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The Discuss tab's composer, or the AI setup notice in its place when no
 * model can be resolved for a new conversation.
 */
export function BookComposer({
	editionId,
	status,
}: {
	editionId: string;
	status: AiStatus;
}) {
	const effect = modelInEffect(status, null);
	// The notice's "choose another model" path: the composer with the picker open.
	const [choosingModel, setChoosingModel] = useState(false);
	if (effect.status === "ok" || choosingModel)
		return (
			<ComposerForm
				editionId={editionId}
				status={status}
				fallback={effect.status === "ok" ? effect.selection : null}
			/>
		);
	return (
		<AiSetupNotice
			effect={effect}
			actions={
				effect.status !== "disabled" &&
				status.providers.length > 0 && (
					<Button
						type="button"
						size="sm"
						onClick={() => setChoosingModel(true)}
					>
						Choose a model
					</Button>
				)
			}
		/>
	);
}

/** The scope sheet's state while it is open. */
interface Sheet {
	/** Opened by sending, so confirming sends too. */
	sending: boolean;
	choice: Choice | null;
	mode: ScopeMode;
	/** An error from starting the conversation, such as a stale choice. */
	error: string | null;
}

function ComposerForm({
	editionId,
	status,
	fallback,
}: {
	editionId: string;
	status: AiStatus;
	/** The chat default; null when it cannot be used, so a model must be chosen. */
	fallback: AiSelection | null;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const create = useServerFn(createConversationFn);
	const coarse = useCoarsePointer();
	const reading = useReadingPosition(editionId);
	const draftId = bookDraftId(editionId);

	const [draft, setDraft] = useState("");
	/** The book the draft above was restored for, so nothing is saved before. */
	const [owner, setOwner] = useState<string | null>(null);
	// The conversation's own model; null follows the chat default.
	const [model, setModel] = useState<AiSelection | null>(() =>
		fallback ? null : initialDraft(status.providers, null),
	);
	/** A scope for the next conversation only; discarded with the page. */
	const [override, setOverride] = useState<Choice | null>(null);
	const [sheet, setSheet] = useState<Sheet | null>(null);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/**
	 * A conversation created for the question whose handoff then could not be
	 * saved, with the request that made it. A retry with the same book, scope
	 * and model reuses it instead of creating another.
	 */
	const unsent = useRef<{ id: string; request: string } | null>(null);

	// Restore the tab's draft before the first paint.
	useLayoutEffect(() => {
		setDraft(loadComposerDraft(draftId)?.text ?? "");
		setOwner(draftId);
	}, [draftId]);
	useEffect(() => {
		if (owner === draftId)
			saveComposerDraft(draftId, { text: draft, attachment: null });
	}, [owner, draftId, draft]);

	const { units, position } = reading;
	const loading =
		reading.positionStatus === "pending" || reading.unitsStatus === "pending";
	const mine = units ? positionChoice(position, units) : null;
	const scope = override ?? mine;
	const labelOf = (choice: Choice) =>
		choice === "whole"
			? "Finished"
			: (units?.find((u) => `unit:${u.endPosition}` === choice)?.label ??
				"the chosen chapter");
	const strip: StripState = loading
		? { kind: "loading" }
		: scope === null
			? { kind: "unset" }
			: scope === "whole"
				? { kind: "whole", once: override !== null }
				: { kind: "unit", label: labelOf(scope), once: override !== null };

	const busy = creating || reading.busy;
	const reason = !draft.trim()
		? "Type a message"
		: loading
			? "Loading your reading position…"
			: creating
				? "Starting the conversation…"
				: model !== null && !model.model.trim()
					? "Choose a model"
					: null;

	const openSheet = (sending: boolean, sheetError: string | null = null) => {
		reading.dismissError();
		setSheet({
			sending,
			// Sending with no position asks afresh; Update starts from the current scope.
			choice: sending ? null : scope,
			mode: "save",
			error: sheetError,
		});
	};

	/** Creates the conversation, hands the message over as its draft, and opens it. */
	const start = async (choice: Choice) => {
		setCreating(true);
		setError(null);
		const data = {
			editionId,
			scope: toScope(choice),
			...(model && { selection: model }),
		};
		const request = JSON.stringify(data);
		try {
			const created =
				unsent.current?.request === request
					? { id: unsent.current.id }
					: await create({ data });
			if (!created) {
				setError("This book is not ready for conversations yet.");
			} else if ("error" in created && created.error === "model_unavailable") {
				setError(
					"That model's provider is not configured on this instance. Choose another model.",
				);
			} else if ("error" in created) {
				// The book was reparsed: reload its units and ask again.
				setOverride(null);
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: readingUnitsKey(editionId),
					}),
					queryClient.invalidateQueries({
						queryKey: readingPositionKey(editionId),
					}),
				]);
				openSheet(true, STALE);
			} else if (
				!saveComposerDraft(created.id, { text: draft, attachment: null })
			) {
				// The conversation sends only what was saved: stay and keep the question.
				unsent.current = { id: created.id, request };
				setError(
					"Could not pass your question to the new conversation because this browser blocked saving it. Allow site data for this page or free some browser storage, then send again.",
				);
			} else {
				unsent.current = null;
				await navigate({
					to: "/c/$conversationId",
					params: { conversationId: created.id },
					state: (prev) => ({ ...prev, autoSend: true }),
				});
				clearComposerDraft(draftId);
				return;
			}
		} catch {
			setError("Could not start a conversation. Please try again.");
		}
		setCreating(false);
	};

	/** After the reading position was saved from the sheet. */
	const saved = (choice: Choice, sending: boolean) => {
		setOverride(null);
		setSheet(null);
		if (sending) void start(choice);
	};

	const confirm = async () => {
		if (!sheet || sheet.choice === null) return;
		const { choice, sending } = sheet;
		if (sheet.mode === "once") {
			setOverride(choice);
			setSheet(null);
			if (sending) void start(choice);
			return;
		}
		const result = await reading.save(choice);
		if (result === "saved") saved(choice, sending);
		else if (result === "stale")
			setSheet((s) => s && { ...s, choice: null, error: null });
		// "confirm": the move-back dialog asks; "failed": the error shows.
	};

	const afterMoveBack = (result: SaveResult) => {
		if (!sheet || sheet.choice === null) return;
		if (result === "saved") saved(sheet.choice, sheet.sending);
		else if (result === "stale")
			setSheet((s) => s && { ...s, choice: null, error: null });
	};

	const send = () => {
		if (reason || busy) return;
		if (scope === null) openSheet(true);
		else void start(scope);
	};

	return (
		<section
			aria-label="Start a conversation"
			className="space-y-3"
			data-testid="book-composer"
		>
			<ScopeStrip
				state={strip}
				disabled={busy}
				onChange={() => openSheet(false)}
				onUsePosition={() => setOverride(null)}
			/>
			<form
				className="rounded-2xl border bg-card p-2 shadow-sm focus-within:border-ring/60"
				onSubmit={(e) => {
					e.preventDefault();
					send();
				}}
			>
				<div className="flex items-end gap-2">
					<AutogrowTextarea
						value={draft}
						onValueChange={setDraft}
						// The submitted text is handed over as is; later edits would be lost.
						readOnly={creating}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing) return;
							// On desktop Enter sends; Shift+Enter, and Enter on touch, fall
							// through to a newline that may continue a list.
							if (e.key === "Enter" && !e.shiftKey && !coarse) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
						name="message"
						maxLength={MESSAGE_LIMIT}
						aria-label="Your question"
						placeholder="Ask about a scene, a character, or a theory…"
						containerClassName="min-w-0 flex-1"
						className="px-2 py-1.5 text-base sm:text-sm"
					/>
					<SendButton busy={false} reason={reason} onStop={() => {}} />
				</div>
			</form>
			<div
				className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm"
				data-testid="book-composer-model"
			>
				<span className="py-0.5 text-muted-foreground">Model:</span>
				<div className="min-w-0 flex-1">
					<ModelChoice
						providers={status.providers}
						fallback={fallback}
						value={model}
						onChange={setModel}
						disabled={busy}
					/>
				</div>
			</div>
			{(error || (reading.error && !sheet)) && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error ?? reading.error}
				</p>
			)}
			<ScopeSheet
				open={sheet !== null}
				onOpenChange={(next) => {
					// Dismissing creates nothing; the typed message stays.
					if (!next) setSheet(null);
				}}
				units={units}
				unitsError={reading.unitsStatus === "error"}
				position={mine}
				choice={sheet?.choice ?? null}
				onChoiceChange={(choice) => {
					reading.dismissError();
					setSheet((s) => s && { ...s, choice, error: null });
				}}
				mode={sheet?.mode ?? "save"}
				onModeChange={(mode) => setSheet((s) => s && { ...s, mode })}
				sending={sheet?.sending ?? false}
				busy={busy}
				error={sheet?.error ?? reading.error}
				onConfirm={() => void confirm()}
			/>
			<MoveBackDialog
				reading={reading}
				label={labelOf}
				onSettled={afterMoveBack}
			/>
		</section>
	);
}
