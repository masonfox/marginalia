import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AI_CREDENTIAL_VARS } from "#/components/chat";
import {
	initialDraft,
	ModelPicker,
	PROVIDER_LABELS,
	selectionLabel,
} from "#/components/model-picker";
import { Button } from "#/components/ui/button";
import { getAiStatusFn } from "#/fns/conversations";
import {
	clearChatDefaultFn,
	clearPreprocessDefaultFn,
	saveChatDefaultFn,
	savePreprocessDefaultFn,
} from "#/fns/settings";
import type { AiDefault } from "#/modules/settings";
import type { AiProviderName } from "#/server/config";

const statusQuery = queryOptions({
	queryKey: ["ai-status"],
	queryFn: () => getAiStatusFn(),
});

export const Route = createFileRoute("/settings")({
	loader: ({ context }) => context.queryClient.ensureQueryData(statusQuery),
	head: () => ({ meta: [{ title: "Settings · Marginalia" }] }),
	component: SettingsPage,
});

function SettingsPage() {
	const { data: status } = useQuery(statusQuery);
	if (!status) return null;
	return (
		<main className="mx-auto max-w-3xl px-4 py-8">
			<h1 className="font-serif text-3xl font-semibold">Settings</h1>
			{status.enabled ? (
				<>
					<p className="mt-1 text-sm text-muted-foreground">
						Available providers:{" "}
						{status.providers.map((p) => PROVIDER_LABELS[p]).join(", ")}. API
						keys and endpoints are set in the environment.
					</p>
					<ChatDefaultCard providers={status.providers} value={status.chat} />
					<PreprocessDefaultCard
						providers={status.providers}
						value={status.preprocess}
					/>
				</>
			) : (
				<section className="mt-6 rounded-lg border border-dashed p-6 text-sm">
					<h2 className="font-medium">No AI provider is configured</h2>
					<p className="mt-2 text-muted-foreground">
						Providers are configured through environment variables, not here.
						Set at least one of{" "}
						{AI_CREDENTIAL_VARS.map((v, i) => (
							<span key={v}>
								{i > 0 && ", "}
								<code className="text-xs">{v}</code>
							</span>
						))}
						, or <code className="text-xs">AI_PROVIDER</code> with{" "}
						<code className="text-xs">AI_API_KEY</code>, then restart
						Marginalia. The default models can then be chosen on this page.
					</p>
				</section>
			)}
		</main>
	);
}

/** Saving and resetting one default, then reloading the status. */
function useDefaultActions() {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Saves report a refusal as `{ error }`; resets return nothing.
	const run = async (
		action: () => Promise<{ error: string | null } | null>,
	) => {
		setBusy(true);
		setError(null);
		try {
			const result = await action();
			if (result?.error) setError(result.error);
			await queryClient.invalidateQueries({ queryKey: statusQuery.queryKey });
		} catch {
			setError("The change could not be saved.");
		} finally {
			setBusy(false);
		}
	};
	return { busy, error, run };
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
	const [draft, setDraft] = useState(() =>
		initialDraft(providers, value.selection),
	);
	return (
		<section
			aria-label="Chat default"
			className="mt-6 space-y-4 rounded-md border p-4"
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
			<ModelPicker
				providers={providers}
				value={draft}
				onChange={setDraft}
				disabled={busy}
			/>
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			<Button
				type="button"
				size="sm"
				disabled={busy || draft.model.trim() === ""}
				onClick={() => run(() => save({ data: { selection: draft } }))}
			>
				Save chat default
			</Button>
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
	const [draft, setDraft] = useState(() =>
		initialDraft(providers, value.sameAsChat ? null : value.selection),
	);
	return (
		<section
			aria-label="Preprocessing default"
			className="mt-6 space-y-4 rounded-md border p-4"
		>
			<CurrentDefault
				title="Preprocessing default"
				value={value}
				sameAsChat={value.sameAsChat}
				busy={busy}
				onReset={() => run(() => reset().then(() => null))}
			/>
			<p className="text-sm text-muted-foreground">
				Used when a book is preprocessed without choosing a model. It may use a
				different provider from chat.
			</p>
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
			{!sameAsChat && (
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
		</section>
	);
}
