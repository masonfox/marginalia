import { useState } from "react";
import { PROVIDER_LABELS } from "#/components/model-picker";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import type {
	CredentialsSaveResult,
	ProviderCredentialsStatus,
} from "#/modules/settings";
import type { AiProviderName } from "#/server/config";

export interface CredentialsDraft {
	provider: AiProviderName;
	apiKey?: string;
	baseUrl: string | null;
	skipCheck?: boolean;
}
export function needsKeyReentry(
	value: ProviderCredentialsStatus,
	baseUrl: string,
): boolean {
	return (
		!!value.apiKeyHint &&
		(baseUrl.replace(/\/+$/, "") || null) !== value.baseUrl
	);
}
export function CredentialCheckError({
	result,
	onSaveAnyway,
	busy = false,
}: {
	result: Exclude<CredentialsSaveResult, { status: "ok" }>;
	onSaveAnyway: () => void;
	busy?: boolean;
}) {
	return (
		<div className="space-y-2">
			<p role="alert" className="text-sm text-destructive-foreground">
				{result.message}
			</p>
			{result.status === "check_failed" && result.canSkip && (
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={onSaveAnyway}
				>
					Save anyway
				</Button>
			)}
		</div>
	);
}
export function ProviderCredentials({
	value,
	onSave,
	onRemove,
}: {
	value: ProviderCredentialsStatus;
	onSave: (draft: CredentialsDraft) => Promise<CredentialsSaveResult>;
	onRemove: (provider: AiProviderName) => Promise<void>;
}) {
	const [editing, setEditing] = useState(false),
		[key, setKey] = useState(""),
		[baseUrl, setBaseUrl] = useState(value.baseUrl ?? ""),
		[busy, setBusy] = useState(false);
	const [error, setError] = useState<Exclude<
		CredentialsSaveResult,
		{ status: "ok" }
	> | null>(null);
	const label = PROVIDER_LABELS[value.provider];
	const keyRequired =
		needsKeyReentry(value, baseUrl) ||
		(value.provider !== "openai-compatible" &&
			(!value.apiKeyHint || value.unreadable));
	const begin = () => {
		setKey("");
		setBaseUrl(value.baseUrl ?? "");
		setError(null);
		setEditing(true);
	};
	const save = async (skipCheck = false) => {
		setBusy(true);
		setError(null);
		try {
			const result = await onSave({
				provider: value.provider,
				...(key.trim() ? { apiKey: key.trim() } : {}),
				baseUrl: baseUrl || null,
				skipCheck,
			});
			if (result.status === "ok") {
				setKey("");
				setEditing(false);
			} else setError(result);
		} catch {
			setError({
				status: "invalid",
				message: "The credentials could not be saved.",
			});
		} finally {
			setBusy(false);
		}
	};
	const remove = async () => {
		setBusy(true);
		setError(null);
		try {
			await onRemove(value.provider);
			setKey("");
			setBaseUrl("");
			setEditing(false);
		} catch {
			setError({
				status: "invalid",
				message: "The provider could not be removed.",
			});
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			aria-label={`${label} credentials`}
			className="space-y-3 rounded-md border p-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium">{label}</h3>
				<span className="text-sm text-muted-foreground">
					{value.configured ? "Configured" : "Not configured"}
				</span>
			</div>
			{value.apiKeyHint && (
				<p className="text-sm">Key set ? ends in {value.apiKeyHint}</p>
			)}
			{value.baseUrl && (
				<p className="break-all text-sm text-muted-foreground">
					{value.baseUrl}
				</p>
			)}
			{value.unreadable && (
				<p role="alert" className="text-sm text-destructive-foreground">
					The saved key cannot be read with this instance's secret. Enter the
					key again.
				</p>
			)}
			{editing ? (
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<label
						htmlFor={`${value.provider}-key`}
						className="block space-y-1 text-sm"
					>
						<span>
							API key
							{value.provider === "openai-compatible" ? " (optional)" : ""}
						</span>
						<Input
							id={`${value.provider}-key`}
							type="password"
							autoComplete="new-password"
							value={key}
							required={keyRequired}
							maxLength={500}
							disabled={busy}
							onChange={(event) => {
								setKey(event.target.value);
								setError(null);
							}}
						/>
					</label>
					<label
						htmlFor={`${value.provider}-url`}
						className="block space-y-1 text-sm"
					>
						<span>
							Base URL
							{value.provider !== "openai-compatible" ? " (optional)" : ""}
						</span>
						<Input
							id={`${value.provider}-url`}
							type="url"
							value={baseUrl}
							required={value.provider === "openai-compatible"}
							disabled={busy}
							onChange={(event) => {
								setBaseUrl(event.target.value);
								setError(null);
							}}
						/>
					</label>
					{keyRequired && value.apiKeyHint && (
						<p className="text-sm text-muted-foreground">
							Enter the API key again to change the base URL or replace an
							unreadable key.
						</p>
					)}
					{error && (
						<CredentialCheckError
							result={error}
							busy={busy}
							onSaveAnyway={() => void save(true)}
						/>
					)}
					<div className="flex gap-2">
						<Button
							type="submit"
							size="sm"
							disabled={busy || (keyRequired && !key.trim())}
						>
							Save provider
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => {
								setKey("");
								setEditing(false);
								setError(null);
							}}
						>
							Cancel
						</Button>
					</div>
				</form>
			) : (
				<>
					<div className="flex flex-wrap gap-2">
						{value.configured || value.unreadable ? (
							<>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={begin}
									disabled={busy}
								>
									Replace key
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={begin}
									disabled={busy}
								>
									Edit base URL
								</Button>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onClick={() => void remove()}
									disabled={busy}
								>
									Remove
								</Button>
							</>
						) : (
							<Button type="button" size="sm" variant="outline" onClick={begin}>
								Add provider
							</Button>
						)}
					</div>
					{error && (
						<CredentialCheckError
							result={error}
							busy={busy}
							onSaveAnyway={() => void save(true)}
						/>
					)}
				</>
			)}
		</section>
	);
}
