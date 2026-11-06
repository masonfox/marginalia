import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookMarked, Plus, X } from "lucide-react";
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { AiSetupNotice, modelInEffect } from "#/components/chat";
import { AutogrowTextarea } from "#/components/composer/autogrow-textarea";
import { SendButton } from "#/components/composer/send-button";
import { initialDraft, ModelChoice } from "#/components/model-picker";
import { ScopePill } from "#/components/pieces";
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
import { Input } from "#/components/ui/input";
import { createConversationFn } from "#/fns/conversations";
import { getEditionFn, listShelfFn } from "#/fns/library";
import { useCoarsePointer } from "#/hooks/use-coarse-pointer";
import {
	readingPositionKey,
	readingUnitsKey,
	type SaveResult,
	useReadingPosition,
} from "#/hooks/use-reading-position";
import { useSentinel } from "#/hooks/use-sentinel";
import {
	bookDraftId,
	clearComposerDraft,
	loadComposerDraft,
	MESSAGE_LIMIT,
	saveComposerDraft,
} from "#/lib/composer-draft";
import { MAX_CONVERSATION_BOOKS } from "#/lib/conversation-books";
import { MAX_SHELF_QUERY, type ShelfStatus } from "#/lib/shelf-status";
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
				<p className="min-w-0 flex-1" data-testid="composer-scope">
					<ScopePill>{scopeText(label)}</ScopePill>
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
	bookTitle,
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
	/** Names the book in the title, when the composer holds several. */
	bookTitle?: string;
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
					<DialogTitle>
						{bookTitle
							? `How far have you read in ${bookTitle}?`
							: "How far have you read?"}
					</DialogTitle>
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

/** A book in the composer: its edition and the title its chip shows. */
export interface ComposerBook {
	editionId: string;
	title: string;
}

/**
 * The Discuss tab's composer for one book: the shared composer starting with
 * that book, which cannot be removed while it is the only one.
 */
export function BookComposer({
	editionId,
	title,
	status,
}: {
	editionId: string;
	title: string;
	status: AiStatus;
}) {
	return (
		<Composer
			initialBooks={[{ editionId, title }]}
			draftId={bookDraftId(editionId)}
			status={status}
			keepOne
		/>
	);
}

/**
 * The composer that starts a conversation about one to three books, or the
 * AI setup notice in its place when no model can be resolved for a new
 * conversation. The book page starts it with its book; the header starts it
 * with none.
 */
export function Composer({
	initialBooks,
	draftId,
	status,
	keepOne = false,
	onStarted,
}: {
	initialBooks: ComposerBook[];
	/** Where the typed message and the chosen books are kept until sent. */
	draftId: string;
	status: AiStatus;
	/** Whether the last book is kept, as on its book page. */
	keepOne?: boolean;
	/** After the conversation was created and opened. */
	onStarted?: () => void;
}) {
	const effect = modelInEffect(status, null);
	// The notice's "choose another model" path: the composer with the picker open.
	const [choosingModel, setChoosingModel] = useState(false);
	if (effect.status === "ok" || choosingModel)
		return (
			<ComposerForm
				initialBooks={initialBooks}
				draftId={draftId}
				keepOne={keepOne}
				onStarted={onStarted}
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

/** What a book row tells the composer about its scope. */
interface BookScope {
	loading: boolean;
	/** The scope the conversation would use; null when the reader must choose. */
	scope: Choice | null;
	busy: boolean;
}

/** A book whose scope the reader is asked for while sending. */
interface Ask {
	/** Changes to open the choices again for the same book. */
	token: number;
	error: string | null;
	/** Whether confirming sends, because no other book is waiting. */
	last: boolean;
}

/** Sending, waiting for the scopes of books without a reading position. */
interface Asking {
	/** Books still to ask, in the order they were added. */
	queue: string[];
	/** Scopes chosen so far, and every other book's scope. */
	chosen: Record<string, Choice>;
	token: number;
	error: string | null;
}

const sameBooks = (a: ComposerBook[], b: ComposerBook[]) =>
	a.length === b.length && a.every((x, i) => x.editionId === b[i]?.editionId);

/** The record without `key`. */
const without = <T,>(record: Record<string, T>, key: string) => {
	const { [key]: _, ...rest } = record;
	return rest;
};

function ComposerForm({
	initialBooks,
	draftId,
	keepOne,
	onStarted,
	status,
	fallback,
}: {
	initialBooks: ComposerBook[];
	draftId: string;
	keepOne: boolean;
	onStarted?: () => void;
	status: AiStatus;
	/** The chat default; null when it cannot be used, so a model must be chosen. */
	fallback: AiSelection | null;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const create = useServerFn(createConversationFn);
	const getEdition = useServerFn(getEditionFn);
	const coarse = useCoarsePointer();

	const [books, setBooks] = useState<ComposerBook[]>(initialBooks);
	const [draft, setDraft] = useState("");
	/** The draft the state above was restored from, so nothing is saved before. */
	const [owner, setOwner] = useState<string | null>(null);
	/** Restored books still being checked, so a book removed since is not sent. */
	const [checking, setChecking] = useState(false);
	// The conversation's own model; null follows the chat default.
	const [model, setModel] = useState<AiSelection | null>(() =>
		fallback ? null : initialDraft(status.providers, null),
	);
	/** Scopes for the next conversation only, by book; discarded with the book or the page. */
	const [overrides, setOverrides] = useState<Record<string, Choice>>({});
	const [scopes, setScopes] = useState<Record<string, BookScope>>({});
	const [asking, setAsking] = useState<Asking | null>(null);
	const [picking, setPicking] = useState(false);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/**
	 * A conversation created for the question whose handoff then could not be
	 * saved, with the request that made it. A retry with the same books,
	 * scopes and model reuses it instead of creating another.
	 */
	const unsent = useRef<{ id: string; request: string } | null>(null);
	const initial = useRef(initialBooks);
	initial.current = initialBooks;

	// Restore the tab's draft before the first paint.
	useLayoutEffect(() => {
		const saved = loadComposerDraft(draftId);
		const restored = saved?.books ?? initial.current;
		setDraft(saved?.text ?? "");
		setBooks(restored);
		setOwner(draftId);
		// Books the composer did not start with may have been deleted or be processing again.
		const known = new Set(initial.current.map((b) => b.editionId));
		const unknown = restored.filter((b) => !known.has(b.editionId));
		if (unknown.length === 0) return;
		let live = true;
		setChecking(true);
		void Promise.all(
			unknown.map(async (b) => {
				try {
					const found = await getEdition({
						data: { editionId: b.editionId },
					});
					return found?.edition.status === "ready" ? null : b.editionId;
				} catch {
					// Unknown: keep it, and creating reports it if it is gone.
					return null;
				}
			}),
		).then((results) => {
			if (!live) return;
			const dropped = new Set(results.filter((id) => id !== null));
			if (dropped.size > 0)
				setBooks((current) => current.filter((b) => !dropped.has(b.editionId)));
			setChecking(false);
		});
		return () => {
			live = false;
		};
	}, [draftId, getEdition]);
	useEffect(() => {
		if (owner !== draftId) return;
		saveComposerDraft(draftId, {
			text: draft,
			attachment: null,
			...(!sameBooks(books, initial.current) && { books }),
		});
	}, [owner, draftId, draft, books]);

	const reportScope = useCallback((editionId: string, next: BookScope) => {
		setScopes((current) => {
			const was = current[editionId];
			if (
				was &&
				was.loading === next.loading &&
				was.scope === next.scope &&
				was.busy === next.busy
			)
				return current;
			return { ...current, [editionId]: next };
		});
	}, []);

	const removeBook = (editionId: string) => {
		setBooks((current) => current.filter((b) => b.editionId !== editionId));
		// A scope for this conversation only goes with the book.
		setOverrides((current) => without(current, editionId));
		setScopes((current) => without(current, editionId));
		setError(null);
	};

	const bookScopes = books.map((b) => scopes[b.editionId]);
	const loading = bookScopes.some((s) => s === undefined || s.loading);
	const busy = creating || bookScopes.some((s) => s?.busy);
	const reason =
		books.length === 0
			? "Add a book"
			: !draft.trim()
				? "Type a message"
				: loading || checking
					? "Loading your reading position…"
					: creating
						? "Starting the conversation…"
						: model !== null && !model.model.trim()
							? "Choose a model"
							: null;

	/** Creates the conversation, hands the message over as its draft, and opens it. */
	const start = async (chosen: Record<string, Choice>) => {
		setCreating(true);
		setError(null);
		const data = {
			books: books.map((b) => ({
				editionId: b.editionId,
				scope: toScope(chosen[b.editionId] ?? "whole"),
			})),
			...(model && { selection: model }),
		};
		const request = JSON.stringify(data);
		try {
			const created =
				unsent.current?.request === request
					? { id: unsent.current.id }
					: await create({ data });
			if ("error" in created && created.error === "model_unavailable") {
				setError(
					"That model's provider is not configured on this instance. Choose another model.",
				);
			} else if ("error" in created && created.error === "not_ready") {
				const title =
					books.find((b) => b.editionId === created.editionId)?.title ??
					"A book";
				setError(
					`${title} is no longer available for conversations. Remove it to continue.`,
				);
			} else if ("error" in created) {
				// The book was reparsed: reload its units and ask again for it.
				const { editionId } = created;
				setOverrides((current) => without(current, editionId));
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: readingUnitsKey(editionId),
					}),
					queryClient.invalidateQueries({
						queryKey: readingPositionKey(editionId),
					}),
				]);
				setAsking((a) => ({
					queue: [editionId],
					chosen: without(chosen, editionId),
					token: (a?.token ?? 0) + 1,
					error: STALE,
				}));
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
				onStarted?.();
				return;
			}
		} catch {
			setError("Could not start a conversation. Please try again.");
		}
		setCreating(false);
	};

	const send = () => {
		if (reason || busy || asking) return;
		const chosen: Record<string, Choice> = {};
		const queue: string[] = [];
		for (const b of books) {
			const scope = scopes[b.editionId]?.scope ?? null;
			if (scope === null) queue.push(b.editionId);
			else chosen[b.editionId] = scope;
		}
		if (queue.length === 0) void start(chosen);
		// Ask for each book without a position in turn, then send.
		else
			setAsking((a) => ({
				queue,
				chosen,
				token: (a?.token ?? 0) + 1,
				error: null,
			}));
	};

	const answered = (editionId: string, choice: Choice) => {
		if (!asking || asking.queue[0] !== editionId) return;
		const chosen = { ...asking.chosen, [editionId]: choice };
		const queue = asking.queue.slice(1);
		if (queue.length === 0) {
			setAsking(null);
			void start(chosen);
		} else setAsking({ ...asking, queue, chosen, error: null });
	};

	return (
		<section
			aria-label="Start a conversation"
			className="space-y-3"
			data-testid="book-composer"
		>
			{books.length === 0 ? (
				<p
					className="text-sm text-muted-foreground"
					data-testid="composer-no-book"
				>
					Add a book to start a conversation about it.
				</p>
			) : (
				<ul
					className="space-y-3"
					aria-label="Books in this conversation"
					data-testid="composer-books"
				>
					{books.map((book) => (
						<BookRow
							key={book.editionId}
							book={book}
							named={books.length > 1}
							removable={!(keepOne && books.length === 1)}
							onRemove={() => removeBook(book.editionId)}
							override={overrides[book.editionId] ?? null}
							onOverrideChange={(choice) =>
								setOverrides((current) =>
									choice === null
										? without(current, book.editionId)
										: { ...current, [book.editionId]: choice },
								)
							}
							onScope={reportScope}
							disabled={busy}
							ask={
								asking?.queue[0] === book.editionId
									? {
											token: asking.token,
											error: asking.error,
											last: asking.queue.length === 1,
										}
									: null
							}
							onAnswered={(choice) => answered(book.editionId, choice)}
							onDismissed={() => setAsking(null)}
						/>
					))}
				</ul>
			)}
			{books.length < MAX_CONVERSATION_BOOKS && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="pointer-coarse:h-11 pointer-coarse:min-w-11"
					disabled={busy}
					onClick={() => setPicking(true)}
				>
					<Plus aria-hidden />
					Add book
				</Button>
			)}
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
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			<BookPicker
				open={picking}
				onOpenChange={setPicking}
				exclude={books.map((b) => b.editionId)}
				onPick={(book) => {
					setPicking(false);
					setError(null);
					setBooks((current) =>
						current.some((b) => b.editionId === book.editionId) ||
						current.length >= MAX_CONVERSATION_BOOKS
							? current
							: [...current, book],
					);
				}}
			/>
		</section>
	);
}

/**
 * One book in the composer: its title, a control to remove it, and its own
 * scope from its own reading position, with the scope choices and the
 * move-back confirmation for this book alone.
 */
function BookRow({
	book,
	named,
	removable,
	onRemove,
	override,
	onOverrideChange,
	onScope,
	disabled,
	ask,
	onAnswered,
	onDismissed,
}: {
	book: ComposerBook;
	/** Whether the scope choices name the book, because there are several. */
	named: boolean;
	removable: boolean;
	onRemove: () => void;
	/** A scope for this conversation only. */
	override: Choice | null;
	onOverrideChange: (choice: Choice | null) => void;
	onScope: (editionId: string, scope: BookScope) => void;
	disabled: boolean;
	/** Set while sending waits for this book's scope. */
	ask: Ask | null;
	onAnswered: (choice: Choice) => void;
	onDismissed: () => void;
}) {
	const { editionId, title } = book;
	const reading = useReadingPosition(editionId);
	const [sheet, setSheet] = useState<Sheet | null>(null);

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

	useEffect(() => {
		onScope(editionId, { loading, scope, busy: reading.busy });
	}, [onScope, editionId, loading, scope, reading.busy]);

	// Sending asks afresh for this book. The latest dismissError, without re-asking when it changes.
	const dismissError = useRef(reading.dismissError);
	dismissError.current = reading.dismissError;
	const askToken = ask?.token;
	const askError = ask?.error ?? null;
	useEffect(() => {
		if (askToken === undefined) return;
		dismissError.current();
		setSheet({ sending: true, choice: null, mode: "save", error: askError });
	}, [askToken, askError]);

	const openSheet = () => {
		reading.dismissError();
		// Update starts from the current scope.
		setSheet({ sending: false, choice: scope, mode: "save", error: null });
	};

	/** After the choice was saved or applied once. */
	const done = (choice: Choice, sending: boolean) => {
		setSheet(null);
		if (sending) onAnswered(choice);
	};

	const confirm = async () => {
		if (!sheet || sheet.choice === null) return;
		const { choice, sending } = sheet;
		if (sheet.mode === "once") {
			onOverrideChange(choice);
			done(choice, sending);
			return;
		}
		const result = await reading.save(choice);
		if (result === "saved") {
			onOverrideChange(null);
			done(choice, sending);
		} else if (result === "stale")
			setSheet((s) => s && { ...s, choice: null, error: null });
		// "confirm": the move-back dialog asks; "failed": the error shows.
	};

	const afterMoveBack = (result: SaveResult) => {
		if (!sheet || sheet.choice === null) return;
		if (result === "saved") {
			onOverrideChange(null);
			done(sheet.choice, sheet.sending);
		} else if (result === "stale")
			setSheet((s) => s && { ...s, choice: null, error: null });
	};

	return (
		<li
			className="space-y-2 rounded-lg border p-3"
			data-testid="composer-book"
			data-edition-id={editionId}
		>
			<div className="flex items-center gap-2">
				<p
					className="min-w-0 flex-1 truncate font-medium"
					data-testid="composer-book-title"
				>
					{title}
				</p>
				{removable && (
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-8 pointer-coarse:size-11"
						aria-label={`Remove ${title}`}
						disabled={disabled}
						onClick={onRemove}
					>
						<X aria-hidden />
					</Button>
				)}
			</div>
			<ScopeStrip
				state={strip}
				disabled={disabled}
				onChange={openSheet}
				onUsePosition={() => onOverrideChange(null)}
			/>
			{reading.error && !sheet && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{reading.error}
				</p>
			)}
			<ScopeSheet
				open={sheet !== null}
				onOpenChange={(next) => {
					if (next) return;
					// Dismissing creates nothing; the typed message and the books stay.
					if (sheet?.sending) onDismissed();
					setSheet(null);
				}}
				bookTitle={named ? title : undefined}
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
				sending={(sheet?.sending ?? false) && (ask?.last ?? true)}
				busy={reading.busy}
				error={sheet?.error ?? reading.error}
				onConfirm={() => void confirm()}
			/>
			<MoveBackDialog
				reading={reading}
				label={labelOf}
				onSettled={afterMoveBack}
			/>
		</li>
	);
}

/** Shelf statuses of books a conversation can be about. */
const READY_STATUSES: ReadonlySet<ShelfStatus> = new Set([
	"not-started",
	"reading",
	"finished",
]);

/**
 * Searches the library by title and author for a book to add, offering only
 * ready books not already in the composer, and loading more as the reader
 * scrolls. The shelf query is unchanged: unusable books are filtered here.
 */
export function BookPicker({
	open,
	onOpenChange,
	exclude,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Books already in the composer. */
	exclude: string[];
	onPick: (book: ComposerBook) => void;
}) {
	const [query, setQuery] = useState("");
	const q = useDeferredValue(query.trim());
	const shelf = useInfiniteQuery({
		queryKey: ["book-picker", q],
		queryFn: ({ pageParam }) =>
			listShelfFn({ data: { q: q || undefined, cursor: pageParam } }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		enabled: open,
	});
	const chosen = new Set(exclude);
	const offered = (shelf.data?.pages ?? [])
		.flatMap((p) => p.items)
		.filter((b) => READY_STATUSES.has(b.status) && !chosen.has(b.id));
	const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } =
		shelf;
	const loadMore = useCallback(() => {
		void fetchNextPage();
	}, [fetchNextPage]);
	// A page holding only unusable books leaves the sentinel in view, so the next loads too.
	const sentinel = useSentinel(
		loadMore,
		open && hasNextPage && !isFetching && !isFetchNextPageError,
	);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) setQuery("");
			}}
		>
			<DialogContent
				data-testid="book-picker"
				className="max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[85dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none"
			>
				<DialogHeader>
					<DialogTitle>Add a book</DialogTitle>
					<DialogDescription>
						Search your library by title or author.
					</DialogDescription>
				</DialogHeader>
				<Input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					maxLength={MAX_SHELF_QUERY}
					aria-label="Search books"
					placeholder="Title or author"
					className="pointer-coarse:h-11"
				/>
				<div className="max-h-80 overflow-y-auto">
					{shelf.isError && !shelf.data ? (
						<p role="alert" className="text-sm text-destructive-foreground">
							Couldn't load your books.{" "}
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => shelf.refetch()}
							>
								Try again
							</Button>
						</p>
					) : offered.length > 0 ? (
						<ul className="space-y-1" aria-label="Books you can add">
							{offered.map((b) => (
								<li key={b.id}>
									<button
										type="button"
										className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none pointer-coarse:min-h-11"
										data-testid="book-picker-option"
										onClick={() => onPick({ editionId: b.id, title: b.title })}
									>
										<span className="block font-medium">{b.title}</span>
										{b.authors.length > 0 && (
											<span className="block text-sm text-muted-foreground">
												{b.authors.join(", ")}
											</span>
										)}
									</button>
								</li>
							))}
						</ul>
					) : shelf.data && !hasNextPage && !isFetching ? (
						<p
							className="text-sm text-muted-foreground"
							data-testid="book-picker-empty"
						>
							{q ? "No ready books match." : "No other ready books."}
						</p>
					) : null}
					<div ref={sentinel} aria-hidden className="h-px" />
					{isFetching && (
						<output className="block py-2 text-center text-sm text-muted-foreground">
							Loading books…
						</output>
					)}
					{isFetchNextPageError && !isFetching && (
						<output className="block py-2 text-center text-sm text-muted-foreground">
							Couldn't load more books.{" "}
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={loadMore}
								className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
							>
								Try again
							</Button>
						</output>
					)}
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
