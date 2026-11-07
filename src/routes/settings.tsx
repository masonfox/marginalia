import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
	initialDraft,
	ModelPicker,
	PROVIDER_LABELS,
	selectionLabel,
} from "#/components/model-picker";
import { ProviderCredentials } from "#/components/provider-credentials";
import { THEME_LABELS } from "#/components/theme-switch";
import { Button } from "#/components/ui/button";
import { getAiStatusFn } from "#/fns/conversations";
import { getShellInfo } from "#/fns/library";
import {
	clearChatDefaultFn,
	clearPreprocessDefaultFn,
	getDiscussionPromptFn,
	listProviderCredentialsFn,
	removeProviderCredentialsFn,
	resetDiscussionPromptFn,
	saveChatDefaultFn,
	saveDiscussionPromptFn,
	savePreprocessDefaultFn,
	saveProviderCredentialsFn,
} from "#/fns/settings";
import { discussionPromptError } from "#/lib/conversation-prompt";
import {
	setThemeChoice,
	THEMES,
	useResolvedTheme,
	useThemeChoice,
} from "#/lib/theme";
import type { AiDefault } from "#/modules/settings";
import type { AiProviderName, AiSelection } from "#/server/config";

const promptQuery = queryOptions({
	queryKey: ["discussion-prompt"],
	queryFn: () => getDiscussionPromptFn(),
});

const statusQuery = queryOptions({
	queryKey: ["ai-status"],
	queryFn: () => getAiStatusFn(),
});

const credentialsQuery = queryOptions({
	queryKey: ["provider-credentials"],
	queryFn: () => listProviderCredentialsFn(),
});
export const Route = createFileRoute("/settings")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(promptQuery),
			context.queryClient.ensureQueryData(statusQuery),
			context.queryClient.ensureQueryData(credentialsQuery),
		]);
	},
	head: () => ({ meta: [{ title: "Settings · Marginalia" }] }),
	component: SettingsPage,
});

function SettingsPage() {
	const { data: status } = useQuery(statusQuery);
	const { data: credentials } = useQuery(credentialsQuery);
	const queryClient = useQueryClient();
	const save = useServerFn(saveProviderCredentialsFn),
		remove = useServerFn(removeProviderCredentialsFn);
	const reload = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: statusQuery.queryKey }),
			queryClient.invalidateQueries({ queryKey: credentialsQuery.queryKey }),
			queryClient.invalidateQueries({ queryKey: ["models"] }),
		]);
	};
	if (!status) return null;
	return (
		<main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-8 sm:py-12">
			<div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12">
				<nav
					aria-label="Settings"
					className="flex flex-wrap content-start gap-1 lg:sticky lg:top-8 lg:flex-col lg:self-start"
				>
					<h1 className="mb-5 w-full px-3 font-serif text-5xl font-semibold tracking-[-0.015em]">
						Settings
					</h1>
					{[
						["appearance", "Appearance"],
						["providers", "Providers"],
						["models", "Default models"],
						["conversation-prompt", "Conversation prompt"],
						["library", "Library"],
						["access", "Access"],
					].map(([id, label]) => (
						<a
							key={id}
							href={`#${id}`}
							className="rounded-[10px] px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
						>
							{label}
						</a>
					))}
				</nav>
				<div className="min-w-0">
					<Appearance />
					<section
						id="providers"
						aria-label="Providers"
						className="scroll-mt-8 border-t py-8 space-y-4"
					>
						<h2 className="font-serif text-[30px] font-semibold">Providers</h2>
						<p className="text-sm text-muted-foreground">
							Add a provider to make its models available. Keys are encrypted
							and never shown again.
						</p>
						{credentials?.map((value) => (
							<ProviderCredentials
								key={value.provider}
								value={value}
								onSave={async (draft) => {
									const result = await save({ data: draft });
									if (result.status === "ok") await reload();
									return result;
								}}
								onRemove={async (provider) => {
									await remove({ data: { provider } });
									await reload();
								}}
							/>
						))}
					</section>
					<div id="models" className="scroll-mt-8 border-t py-8">
						<h2 className="font-serif text-[30px] font-semibold">
							Default models
						</h2>
						{status.enabled ? (
							<>
								<p className="mt-1 text-sm text-muted-foreground">
									Available providers:{" "}
									{status.providers.map((p) => PROVIDER_LABELS[p]).join(", ")}.
								</p>
								<ChatDefaultCard
									providers={status.providers}
									value={status.chat}
								/>
								<PreprocessDefaultCard
									providers={status.providers}
									value={status.preprocess}
								/>
							</>
						) : (
							<>
								<section className="mt-6 rounded-lg border border-dashed p-6 text-sm">
									<h2 className="font-medium">No AI provider is configured</h2>
									<p className="mt-2 text-muted-foreground">
										Add a provider above, then choose default models here.
									</p>
								</section>
								{/* Saved defaults stay visible, unavailable, and clearable. */}
								{(status.chat.selection || !status.preprocess.sameAsChat) && (
									<>
										<ChatDefaultCard providers={[]} value={status.chat} />
										<PreprocessDefaultCard
											providers={[]}
											value={status.preprocess}
										/>
									</>
								)}
							</>
						)}
					</div>
					<ConversationPrompt />
					<InstanceSettings />
				</div>
			</div>
		</main>
	);
}

/** Saving and clearing one default, then reloading the status. */
function useDefaultActions() {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Saves report a refusal as `{ error }`; resets return nothing.
	// Resolves whether the change was made.
	const run = async (
		action: () => Promise<{ error: string | null } | null>,
	): Promise<boolean> => {
		setBusy(true);
		setError(null);
		try {
			const result = await action();
			if (result?.error) setError(result.error);
			await queryClient.invalidateQueries({ queryKey: statusQuery.queryKey });
			return !result?.error;
		} catch {
			setError("The change could not be saved.");
			return false;
		} finally {
			setBusy(false);
		}
	};
	return { busy, error, run };
}

/**
 * The picker's draft, kept across status reloads so unsaved edits survive;
 * reset when its provider is no longer available.
 */
function useDraft(providers: AiProviderName[], selection: AiSelection | null) {
	const [draft, setDraft] = useState(() => initialDraft(providers, selection));
	if (providers.length > 0 && !providers.includes(draft.provider)) {
		setDraft(initialDraft(providers, null));
	}
	return [draft, setDraft] as const;
}

function CurrentDefault({
	title,
	value,
	sameAsChat = false,
	busy,
	onReset,
}: {
	title: string;
	value: AiDefault;
	sameAsChat?: boolean;
	busy: boolean;
	onReset: () => void;
}) {
	const current = value.selection ? selectionLabel(value.selection) : "None";
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-medium">{title}</h2>
				<div className="flex items-center gap-2">
					{value.selection && !sameAsChat && (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							disabled={busy}
							onClick={onReset}
						>
							Clear
						</Button>
					)}
				</div>
			</div>
			<p className="text-sm">
				Current: {sameAsChat ? `Same as chat (${current})` : current}
			</p>
			{value.selection && !value.available && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{PROVIDER_LABELS[value.selection.provider]} has no credentials, so
					this default is unavailable. Choose another model or add the
					provider's credentials.
				</p>
			)}
		</div>
	);
}

function ChatDefaultCard({
	providers,
	value,
}: {
	providers: AiProviderName[];
	value: AiDefault;
}) {
	const save = useServerFn(saveChatDefaultFn);
	const reset = useServerFn(clearChatDefaultFn);
	const { busy, error, run } = useDefaultActions();
	const [draft, setDraft] = useDraft(providers, value.selection);
	return (
		<section
			aria-label="Chat default"
			className="mt-5 space-y-4 rounded-2xl border bg-card p-5"
		>
			<CurrentDefault
				title="Chat default"
				value={value}
				busy={busy}
				onReset={() => run(() => reset().then(() => null))}
			/>
			<p className="text-sm text-muted-foreground">
				Used by conversations that do not have their own model.
			</p>
			{providers.length > 0 && (
				<ModelPicker
					providers={providers}
					value={draft}
					onChange={setDraft}
					disabled={busy}
				/>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			{providers.length > 0 && (
				<Button
					type="button"
					size="sm"
					disabled={busy || draft.model.trim() === ""}
					onClick={() => run(() => save({ data: { selection: draft } }))}
				>
					Save chat default
				</Button>
			)}
		</section>
	);
}

function PreprocessDefaultCard({
	providers,
	value,
}: {
	providers: AiProviderName[];
	value: AiDefault & { sameAsChat: boolean };
}) {
	const save = useServerFn(savePreprocessDefaultFn);
	const reset = useServerFn(clearPreprocessDefaultFn);
	const { busy, error, run } = useDefaultActions();
	const [sameAsChat, setSameAsChat] = useState(value.sameAsChat);
	const [draft, setDraft] = useDraft(
		providers,
		value.sameAsChat ? null : value.selection,
	);
	return (
		<section
			aria-label="Preprocessing default"
			className="mt-5 space-y-4 rounded-2xl border bg-card p-5"
		>
			<CurrentDefault
				title="Preprocessing default"
				value={value}
				sameAsChat={value.sameAsChat}
				busy={busy}
				onReset={async () => {
					// A cleared default follows chat; the old draft would restore it.
					if (await run(() => reset().then(() => null))) {
						setSameAsChat(true);
						setDraft(initialDraft(providers, null));
					}
				}}
			/>
			<p className="text-sm text-muted-foreground">
				Used when a book is preprocessed without choosing a model. It may use a
				different provider from chat.
			</p>
			{providers.length > 0 && (
				<fieldset className="space-y-1 text-sm" disabled={busy}>
					<legend className="sr-only">Preprocessing model</legend>
					<label className="flex items-center gap-2">
						<input
							type="radio"
							name="preprocess-mode"
							checked={sameAsChat}
							onChange={() => setSameAsChat(true)}
						/>
						Same as the chat default
					</label>
					<label className="flex items-center gap-2">
						<input
							type="radio"
							name="preprocess-mode"
							checked={!sameAsChat}
							onChange={() => setSameAsChat(false)}
						/>
						A specific model
					</label>
				</fieldset>
			)}
			{providers.length > 0 && !sameAsChat && (
				<ModelPicker
					providers={providers}
					value={draft}
					onChange={setDraft}
					disabled={busy}
				/>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			{providers.length > 0 && (
				<Button
					type="button"
					size="sm"
					disabled={busy || (!sameAsChat && draft.model.trim() === "")}
					onClick={() =>
						run(() =>
							save({
								data: { selection: sameAsChat ? "same-as-chat" : draft },
							}),
						)
					}
				>
					Save preprocessing default
				</Button>
			)}
		</section>
	);
}

/** Theme previews use the same theme tokens as every screen. */
export function Appearance() {
	const choice = useThemeChoice();
	const resolved = useResolvedTheme();
	return (
		<section
			id="appearance"
			aria-label="Appearance"
			className="scroll-mt-8 pb-8"
		>
			<h2 className="font-serif text-[30px] font-semibold">Appearance</h2>
			<fieldset className="mt-5 grid grid-cols-3 gap-2 sm:gap-4">
				<legend className="sr-only">Display theme</legend>
				{THEMES.map((theme) => (
					<label key={theme} className="relative min-w-0 cursor-pointer">
						<input
							type="radio"
							name="display-theme"
							value={theme}
							checked={resolved === theme}
							onChange={() => setThemeChoice(theme)}
							className="peer sr-only"
						/>
						<span className="block overflow-hidden rounded-[14px] border-2 border-input p-1 peer-checked:border-amber peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring">
							<span
								data-theme={theme}
								aria-hidden
								className="flex h-[108px] gap-2 rounded-t-[9px] bg-background p-3 text-foreground sm:p-4"
							>
								<span className="block h-[51px] w-[34px] shrink-0 rounded-[2px_4px_4px_2px] bg-[#1d3a5f] shadow-cover max-sm:h-10 max-sm:w-6" />
								<span className="block min-w-0 flex-1 space-y-2 pt-1">
									<span className="block h-2 w-3/4 rounded bg-foreground" />
									<span className="block h-1.5 w-full rounded bg-input" />
									<span className="block h-1.5 w-4/5 rounded bg-input" />
									<span className="block h-3 w-2/3 rounded-full bg-amber-soft" />
								</span>
							</span>
							<span className="block px-2 py-2 text-center text-sm font-medium">
								{THEME_LABELS[theme]}
							</span>
						</span>
					</label>
				))}
			</fieldset>
			<label className="mt-4 flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-sm">
				<input
					type="checkbox"
					checked={choice === "system"}
					onChange={(event) =>
						setThemeChoice(
							event.target.checked ? "system" : (resolved ?? "light"),
						)
					}
					className="size-4 accent-primary"
				/>
				Match my system
			</label>
		</section>
	);
}

function InstanceSettings() {
	const { data: shell } = useQuery({
		queryKey: ["shell-info"],
		queryFn: () => getShellInfo(),
	});
	return (
		<>
			<section
				id="library"
				aria-label="Library"
				className="scroll-mt-8 border-t py-8"
			>
				<h2 className="font-serif text-[30px] font-semibold">Library</h2>
				<p className="mt-3 rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
					{shell
						? shell.hasLibraryPaths
							? "Library folders are configured for this instance."
							: "No library folders are configured for this instance."
						: "Loading..."}
				</p>
			</section>
			<section
				id="access"
				aria-label="Access"
				className="scroll-mt-8 border-t py-8"
			>
				<h2 className="font-serif text-[30px] font-semibold">Access</h2>
				{shell && (
					<div className="mt-3 rounded-2xl border border-amber/45 bg-amber-soft p-5 text-sm">
						<p className="font-semibold">
							{shell.authEnabled
								? "Password protection is enabled"
								: "No password is set"}
						</p>
						{!shell.authEnabled && (
							<p className="mt-2 text-muted-foreground">
								Anyone who can reach this instance can use it. Set{" "}
								<code>AUTH_PASSWORD</code> in your environment and restart to
								turn on sign-in.
							</p>
						)}
					</div>
				)}
			</section>
		</>
	);
}

function ConversationPrompt() {
	const { data } = useQuery(promptQuery);
	const queryClient = useQueryClient();
	const save = useServerFn(saveDiscussionPromptFn);
	const reset = useServerFn(resetDiscussionPromptFn);
	const [draft, setDraft] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	if (!data) return <output>Loading conversation prompt...</output>;
	const text = draft ?? data.text;
	const run = async (resetting: boolean) => {
		const invalid = resetting ? null : discussionPromptError(text);
		if (invalid) {
			setError(invalid);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			if (resetting) {
				const latest = await reset();
				queryClient.setQueryData(promptQuery.queryKey, latest);
			} else {
				const result = await save({ data: text });
				if (result.error) {
					setError(result.error);
					return;
				}
			}
			await queryClient.invalidateQueries({ queryKey: promptQuery.queryKey });
			setDraft(null);
		} catch {
			setError("The conversation prompt could not be saved. Please try again.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			id="conversation-prompt"
			aria-label="Conversation prompt"
			className="scroll-mt-8 border-t py-8 space-y-4"
		>
			<h2 className="font-serif text-[30px] font-semibold">
				Conversation prompt
			</h2>
			<p>
				Current:{" "}
				<strong>{data.mode === "custom" ? "Custom" : "Default"}</strong>
			</p>
			<p className="text-sm text-muted-foreground">
				Saving replaces the global discussion instructions for the next reply in
				all new and existing conversations. Unsaved edits have no effect. Custom
				prompts do not receive default discussion improvements; Return to
				default restores the latest default and future improvements.
			</p>
			<p className="text-sm text-muted-foreground">
				You own grounding, interpretation, stance, style, and spoiler behavior.
				Marginalia still maintains citation syntax, tool contracts and budgets,
				and current book and scope context. Scope controls still bound tool
				access, and citations are verified. Changing spoiler instructions can
				reveal later events from the assistant’s own knowledge.
			</p>
			<label htmlFor="discussion-prompt" className="block text-sm font-medium">
				Discussion instructions
			</label>
			<textarea
				id="discussion-prompt"
				rows={18}
				value={text}
				disabled={busy}
				onChange={(e) => setDraft(e.target.value)}
				aria-describedby="discussion-prompt-limit"
				className="w-full rounded-md border bg-background p-3 text-sm"
			/>
			<p id="discussion-prompt-limit" className="text-sm text-muted-foreground">
				{text.length.toLocaleString()} / 32,000 characters
			</p>
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			<div className="flex gap-2">
				<Button disabled={busy} onClick={() => run(false)}>
					Save conversation prompt
				</Button>
				{data.mode === "custom" && (
					<Button variant="outline" disabled={busy} onClick={() => run(true)}>
						Return to default
					</Button>
				)}
			</div>
		</section>
	);
}
