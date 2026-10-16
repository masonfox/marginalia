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
import { Button } from "#/components/ui/button";
import { getAiStatusFn } from "#/fns/conversations";
import {
	clearChatDefaultFn,
	clearPreprocessDefaultFn,
	listProviderCredentialsFn,
	removeProviderCredentialsFn,
	saveChatDefaultFn,
	savePreprocessDefaultFn,
	saveProviderCredentialsFn,
} from "#/fns/settings";
import type { AiDefault } from "#/modules/settings";
import type { AiProviderName } from "#/server/config";

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
		<main className="mx-auto max-w-3xl px-4 py-8">
			<h1 className="font-serif text-3xl font-semibold">Settings</h1>
			<section aria-label="Providers" className="mt-6 space-y-3">
				<h2 className="text-lg font-medium">Providers</h2>
				<p className="text-sm text-muted-foreground">
					Add a provider to make its models available. Keys are encrypted and
					never shown again.
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
			{status.enabled ? (
				<>
					<p className="mt-1 text-sm text-muted-foreground">
						Available providers:{" "}
						{status.providers.map((p) => PROVIDER_LABELS[p]).join(", ")}.
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
						Add a provider above, then choose default models here.
					</p>
				</section>
			)}
		</main>
	);
}

/** Saving and clearing one default, then reloading the status. */
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
