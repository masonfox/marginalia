import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { relativeTime } from "#/lib/relative-time";
import type {
	ConnectionTestResult,
	ProviderKind,
	ProviderSettingsView,
	StoredReading,
	SyncSchedule,
	UnmatchedBook,
} from "#/modules/progress";

// Settings' "Reading sync" section: one card per progress provider, in
// priority order, with a form generated from its config fields.

export const SCHEDULE_LABELS: Record<SyncSchedule, string> = {
	manual: "Manual only",
	"1h": "Every hour",
	"6h": "Every 6 hours",
	"24h": "Daily",
};

export type SaveOutcome =
	| { status: "ok" }
	| { status: "invalid"; message: string };

export type SyncNowOutcome = {
	status: "queued" | "already-queued" | "disabled";
};

export interface EditionChoice {
	id: string;
	title: string;
	authors: string[];
}

export interface ReadingSyncActions {
	save(
		kind: ProviderKind,
		values: Record<string, string>,
	): Promise<SaveOutcome>;
	setEnabled(kind: ProviderKind, enabled: boolean): Promise<SaveOutcome>;
	setSchedule(kind: ProviderKind, schedule: SyncSchedule): Promise<SaveOutcome>;
	reorder(order: ProviderKind[]): Promise<{ status: "ok" | "invalid" }>;
	test(
		kind: ProviderKind,
		values: Record<string, string>,
	): Promise<ConnectionTestResult>;
	syncNow(kind: ProviderKind): Promise<SyncNowOutcome>;
	link(
		kind: ProviderKind,
		externalId: string,
		editionId: string,
	): Promise<{ status: "ok" | "not-found" }>;
	searchEditions(q: string): Promise<EditionChoice[]>;
}

const selectClass =
	"h-11 w-full rounded-[12px] border border-input bg-card px-3 text-base text-foreground outline-none focus-visible:border-amber focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50 md:text-sm sm:w-auto";

const FAILED = "The change could not be saved.";

export function ReadingSync({
	providers,
	unmatched,
	actions,
	now,
}: {
	providers: ProviderSettingsView[];
	unmatched: UnmatchedBook[];
	actions: ReadingSyncActions;
	now?: Date;
}) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const order = providers.map((p) => p.kind);
	const move = async (index: number, by: -1 | 1) => {
		const next = [...order];
		const [kind] = next.splice(index, 1);
		if (!kind) return;
		next.splice(index + by, 0, kind);
		setBusy(true);
		setError(null);
		try {
			const result = await actions.reorder(next);
			if (result.status !== "ok") setError("The order could not be saved.");
		} catch {
			setError("The order could not be saved.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Keep each book's reading position in step with a reading tracker.
				Progress only comes in, and a position never moves past the last chapter
				you finished. When several providers track the same book, the highest
				one in this list wins.
			</p>
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			<ol className="space-y-4">
				{providers.map((provider, index) => (
					<li key={provider.kind}>
						<ProviderSyncCard
							provider={provider}
							rank={index + 1}
							unmatched={unmatched.filter(
								(b) => b.providerKind === provider.kind,
							)}
							actions={actions}
							now={now}
							onMoveUp={index > 0 && !busy ? () => move(index, -1) : null}
							onMoveDown={
								index < providers.length - 1 && !busy
									? () => move(index, 1)
									: null
							}
						/>
					</li>
				))}
			</ol>
		</div>
	);
}

/** Field values the form starts from: plain values as saved, secrets blank. */
function initialValues(provider: ProviderSettingsView): Record<string, string> {
	return Object.fromEntries(
		provider.configFields.map((f) => [
			f.key,
			f.type === "secret" ? "" : (provider.values[f.key] ?? ""),
		]),
	);
}

function statusLabel(p: ProviderSettingsView): string {
	if (!p.configured) return "Not set up";
	return p.enabled ? "On" : "Off";
}

export function ProviderSyncCard({
	provider,
	rank,
	unmatched,
	actions,
	now,
	onMoveUp,
	onMoveDown,
}: {
	provider: ProviderSettingsView;
	rank: number;
	unmatched: UnmatchedBook[];
	actions: ReadingSyncActions;
	now?: Date;
	onMoveUp: (() => void) | null;
	onMoveDown: (() => void) | null;
}) {
	const id = useId();
	const { kind, label } = provider;
	const [values, setValues] = useState(() => initialValues(provider));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [test, setTest] = useState<ConnectionTestResult | null>(null);

	const run = async (
		action: () => Promise<SaveOutcome>,
		done?: string,
	): Promise<boolean> => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const result = await action();
			if (result.status === "invalid") {
				setError(result.message);
				return false;
			}
			if (done) setNotice(done);
			return true;
		} catch {
			setError(FAILED);
			return false;
		} finally {
			setBusy(false);
		}
	};

	const save = async () => {
		if (await run(() => actions.save(kind, values), "Saved.")) {
			// Secrets are never shown again; their hints come from the reload.
			setValues((v) =>
				Object.fromEntries(
					provider.configFields.map((f) => [
						f.key,
						f.type === "secret" ? "" : (v[f.key] ?? ""),
					]),
				),
			);
			setTest(null);
		}
	};

	const testConnection = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		setTest(null);
		try {
			setTest(await actions.test(kind, values));
		} catch {
			setError("The connection could not be tested.");
		} finally {
			setBusy(false);
		}
	};

	const syncNow = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const { status } = await actions.syncNow(kind);
			setNotice(
				status === "queued"
					? `${label} sync started.`
					: status === "already-queued"
						? `A ${label} sync is already running.`
						: `Turn on ${label} to sync it.`,
			);
		} catch {
			setError("The sync could not be started.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<section
			aria-label={`${label} reading sync`}
			className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<h3 className="font-medium">{label}</h3>
					<p className="text-sm text-muted-foreground">
						Priority {rank} · {statusLabel(provider)}
					</p>
				</div>
				<div className="flex shrink-0 gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={`Move ${label} up`}
						disabled={!onMoveUp}
						onClick={() => onMoveUp?.()}
					>
						<ArrowUp aria-hidden />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={`Move ${label} down`}
						disabled={!onMoveDown}
						onClick={() => onMoveDown?.()}
					>
						<ArrowDown aria-hidden />
					</Button>
				</div>
			</div>
			{provider.help && (
				<p className="text-sm text-muted-foreground">{provider.help}</p>
			)}
			{provider.unreadable && (
				<p role="alert" className="text-sm text-destructive-foreground">
					The saved secrets cannot be read with this instance's secret key.
					Enter them again.
				</p>
			)}
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
				<label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-sm">
					<input
						type="checkbox"
						checked={provider.enabled}
						disabled={busy}
						onChange={(event) =>
							void run(() => actions.setEnabled(kind, event.target.checked))
						}
						className="size-4 accent-primary"
					/>
					Sync from {label}
				</label>
				<label
					htmlFor={`${id}-schedule`}
					className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2"
				>
					<span>Schedule</span>
					<select
						id={`${id}-schedule`}
						className={selectClass}
						value={provider.schedule}
						disabled={busy}
						onChange={(event) =>
							void run(() =>
								actions.setSchedule(
									kind,
									event.currentTarget.value as SyncSchedule,
								),
							)
						}
					>
						{Object.entries(SCHEDULE_LABELS).map(([value, text]) => (
							<option key={value} value={value}>
								{text}
							</option>
						))}
					</select>
				</label>
			</div>
			<form
				className="space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				{provider.configFields.map((field) => {
					const inputId = `${id}-${field.key}`;
					const secret = provider.secrets[field.key];
					return (
						<div key={field.key} className="space-y-1 text-sm">
							<label htmlFor={inputId} className="block">
								{field.label}
								{field.required ? "" : " (optional)"}
							</label>
							<Input
								id={inputId}
								type={
									field.type === "secret"
										? "password"
										: field.type === "url"
											? "url"
											: "text"
								}
								autoComplete={field.type === "secret" ? "new-password" : "off"}
								value={values[field.key] ?? ""}
								maxLength={2000}
								disabled={busy}
								placeholder={
									secret?.set
										? secret.hint
											? `Saved, ends in ${secret.hint}`
											: "Saved"
										: undefined
								}
								aria-describedby={`${inputId}-note`}
								onChange={(event) => {
									const value = event.target.value;
									setValues((v) => ({ ...v, [field.key]: value }));
									setTest(null);
								}}
							/>
							<p id={`${inputId}-note`} className="text-muted-foreground">
								{field.type === "secret"
									? secret?.set
										? `Set${secret.hint ? `, ends in ${secret.hint}` : ""}. Leave blank to keep it.`
										: "Not set."
									: null}
								{field.type === "secret" && field.hint ? " " : null}
								{field.hint}
							</p>
						</div>
					);
				})}
				{test && <TestOutcome result={test} />}
				<div className="flex flex-wrap gap-2">
					<Button type="submit" disabled={busy}>
						Save
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={() => void testConnection()}
					>
						Test connection
					</Button>
				</div>
			</form>
			<div className="space-y-2 border-t pt-4">
				<SyncStatus provider={provider} now={now} />
				<Button
					type="button"
					variant="outline"
					disabled={busy || !provider.enabled}
					onClick={() => void syncNow()}
				>
					Sync now
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			{notice && (
				<output className="block text-sm text-muted-foreground">
					{notice}
				</output>
			)}
			{unmatched.length > 0 && (
				<UnmatchedList
					kind={kind}
					label={label}
					books={unmatched}
					actions={actions}
				/>
			)}
		</section>
	);
}

function TestOutcome({ result }: { result: ConnectionTestResult }) {
	const ok = result.status === "ok";
	return (
		<div
			role={ok ? "status" : "alert"}
			className={
				ok ? "text-sm text-foreground" : "text-sm text-destructive-foreground"
			}
		>
			<p>{result.message}</p>
			{"detail" in result && result.detail && (
				<p className="break-words text-muted-foreground">{result.detail}</p>
			)}
		</div>
	);
}

function SyncStatus({
	provider,
	now,
}: {
	provider: ProviderSettingsView;
	now?: Date;
}) {
	const last = provider.lastSyncAt ? new Date(provider.lastSyncAt) : null;
	return (
		<div className="space-y-1 text-sm">
			<p>
				{last ? (
					<>
						Last synced{" "}
						<time dateTime={last.toISOString()} title={last.toLocaleString()}>
							{relativeTime(last, now)}
						</time>
						{provider.lastSyncMatched !== null &&
							` · ${provider.lastSyncMatched} ${provider.lastSyncMatched === 1 ? "book" : "books"} matched`}
					</>
				) : (
					"Not synced yet"
				)}
			</p>
			{provider.lastError && (
				<p role="alert" className="text-destructive-foreground">
					{provider.lastError}
				</p>
			)}
		</div>
	);
}

/** "42%", "page 120 of 300", or nothing for a reading without a place. */
export function readingSummary(reading: StoredReading): string | null {
	if (reading.fraction !== undefined)
		return `${Math.floor(reading.fraction * 100)}%`;
	if (reading.pages)
		return `page ${reading.pages.current} of ${reading.pages.total}`;
	return null;
}

function UnmatchedList({
	kind,
	label,
	books,
	actions,
}: {
	kind: ProviderKind;
	label: string;
	books: UnmatchedBook[];
	actions: ReadingSyncActions;
}) {
	return (
		<div className="space-y-2 border-t pt-4">
			<h4 className="text-sm font-medium">Books not in your library</h4>
			<p className="text-sm text-muted-foreground">
				You are reading these in {label}, but no book here matched them. Link
				each one to its book to sync it.
			</p>
			<ul className="divide-y">
				{books.map((book) => (
					<li key={book.externalId} className="py-3">
						<UnmatchedRow kind={kind} book={book} actions={actions} />
					</li>
				))}
			</ul>
		</div>
	);
}

function UnmatchedRow({
	kind,
	book,
	actions,
}: {
	kind: ProviderKind;
	book: UnmatchedBook;
	actions: ReadingSyncActions;
}) {
	const [picking, setPicking] = useState(false);
	const summary = readingSummary(book.reading);
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0 text-sm">
					<p className="font-medium break-words">{book.title}</p>
					<p className="text-muted-foreground">
						{[book.authors.join(", "), summary].filter(Boolean).join(" · ")}
					</p>
				</div>
				{!picking && (
					<Button
						type="button"
						variant="outline"
						onClick={() => setPicking(true)}
					>
						Link to a book
					</Button>
				)}
			</div>
			{picking && (
				<EditionPicker
					title={book.title}
					search={actions.searchEditions}
					onCancel={() => setPicking(false)}
					onPick={async (editionId) => {
						const result = await actions.link(kind, book.externalId, editionId);
						if (result.status === "ok") setPicking(false);
						return result.status === "ok"
							? null
							: "That book or provider no longer exists.";
					}}
				/>
			)}
		</div>
	);
}

/** Searches the library by title or author and picks one edition. */
export function EditionPicker({
	title,
	search,
	onPick,
	onCancel,
}: {
	title: string;
	search: (q: string) => Promise<EditionChoice[]>;
	/** Resolves an error message, or null when linked. */
	onPick: (editionId: string) => Promise<string | null>;
	onCancel: () => void;
}) {
	const id = useId();
	const [q, setQ] = useState(title);
	const [results, setResults] = useState<EditionChoice[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let current = true;
		const timer = setTimeout(() => {
			search(q.trim())
				.then((found) => {
					if (current) setResults(found);
				})
				.catch(() => {
					if (current) setError("The library could not be searched.");
				});
		}, 250);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [q, search]);

	return (
		<div className="space-y-2 rounded-xl border p-3">
			<label htmlFor={`${id}-q`} className="block text-sm">
				Find the book in your library
			</label>
			<Input
				id={`${id}-q`}
				type="search"
				value={q}
				disabled={busy}
				onChange={(event) => {
					setQ(event.target.value);
					setError(null);
				}}
			/>
			{results === null ? (
				<p className="text-sm text-muted-foreground">Searching…</p>
			) : results.length === 0 ? (
				<p className="text-sm text-muted-foreground">No books match.</p>
			) : (
				<ul aria-label="Matching books" className="space-y-1">
					{results.map((edition) => (
						<li key={edition.id}>
							<button
								type="button"
								disabled={busy}
								className="flex min-h-11 w-full flex-col justify-center rounded-[10px] px-3 py-2 text-left text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
								onClick={async () => {
									setBusy(true);
									setError(null);
									try {
										setError(await onPick(edition.id));
									} catch {
										setError("The book could not be linked.");
									} finally {
										setBusy(false);
									}
								}}
							>
								<span className="font-medium break-words">{edition.title}</span>
								{edition.authors.length > 0 && (
									<span className="text-muted-foreground">
										{edition.authors.join(", ")}
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			<Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
				Cancel
			</Button>
		</div>
	);
}
