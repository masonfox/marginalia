import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { listModelsFn } from "#/fns/settings";
import type { ListedModel, ModelList } from "#/modules/ai";
import type { AiProviderName, AiSelection } from "#/server/config";

export const PROVIDER_LABELS: Record<AiProviderName, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	google: "Google",
	"openai-compatible": "OpenAI-compatible",
};

/** "Anthropic / claude-sonnet-4-5". */
export const selectionLabel = (s: AiSelection) =>
	`${PROVIDER_LABELS[s.provider]} / ${s.model}`;

/** "$3.00 in · $15.00 out per million tokens", or that the price is unknown. */
export function priceLabel(price: ListedModel["price"]): string {
	if (!price) return "Price unknown";
	return `$${price.input.toFixed(2)} in · $${price.output.toFixed(2)} out per million tokens`;
}

/**
 * What the picker says under the model field: the listing failed, the typed
 * id is not in the list, or nothing. Any typed id is accepted either way.
 */
export function modelNotice(
	model: string,
	list: ModelList | undefined,
): "error" | "unlisted" | null {
	if (!list) return null;
	if (list.error) return "error";
	const id = model.trim();
	if (id === "" || list.models.some((m) => m.id === id)) return null;
	return "unlisted";
}

/** Ends a message with a period; masked provider errors often lack one. */
const sentence = (text: string) =>
	/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

const selectClass =
	"h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

/** Presentational picker; the container below loads the model list. */
export function ModelPickerView({
	providers,
	value,
	onChange,
	list,
	loading = false,
	onRefresh,
	disabled = false,
}: {
	/** Providers with credentials; the only ones offered. */
	providers: AiProviderName[];
	value: AiSelection;
	onChange: (value: AiSelection) => void;
	/** The listing for `value.provider`; undefined while loading. */
	list?: ModelList;
	loading?: boolean;
	onRefresh?: () => void;
	disabled?: boolean;
}) {
	const id = useId();
	const notice = modelNotice(value.model, list);
	const listed = list?.models.find((m) => m.id === value.model.trim());
	const label = PROVIDER_LABELS[value.provider];
	return (
		<div className="space-y-3 text-sm">
			<div className="space-y-1">
				<label htmlFor={`${id}-provider`} className="block font-medium">
					Provider
				</label>
				<select
					id={`${id}-provider`}
					className={selectClass}
					value={value.provider}
					disabled={disabled}
					onChange={(e) =>
						onChange({
							provider: e.target.value as AiProviderName,
							model: "",
						})
					}
				>
					{providers.map((p) => (
						<option key={p} value={p}>
							{PROVIDER_LABELS[p]}
						</option>
					))}
				</select>
			</div>
			<div className="space-y-1">
				<label htmlFor={`${id}-model`} className="block font-medium">
					Model
				</label>
				<div className="flex gap-2">
					<Input
						id={`${id}-model`}
						list={`${id}-models`}
						value={value.model}
						disabled={disabled}
						placeholder={
							loading ? "Loading models…" : "Choose or type a model id"
						}
						autoComplete="off"
						spellCheck={false}
						maxLength={200}
						aria-describedby={`${id}-notice`}
						onChange={(e) =>
							onChange({ provider: value.provider, model: e.target.value })
						}
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						disabled={disabled || loading || !onRefresh}
						onClick={onRefresh}
						aria-label={`Refresh ${label} models`}
						title="Refresh the model list"
					>
						<RefreshCw className={loading ? "animate-spin" : undefined} />
					</Button>
				</div>
				<datalist id={`${id}-models`}>
					{list?.models.map((m) => (
						<option
							key={m.id}
							value={m.id}
							label={`${m.name ? `${m.name} · ` : ""}${priceLabel(m.price)}`}
						/>
					))}
				</datalist>
				<div id={`${id}-notice`} className="space-y-1">
					{notice === "error" && (
						<p role="alert" className="text-destructive-foreground">
							{sentence(list?.error ?? "")} You can still type a model id.
						</p>
					)}
					{notice === "unlisted" && (
						<p className="text-muted-foreground">
							Not found in {label}'s model list. It will be used as typed.
						</p>
					)}
					{list && !list.error && list.models.length > 0 && (
						<p className="text-muted-foreground">
							{list.models.length === 1
								? "1 model listed"
								: `${list.models.length} models listed`}
							{listed && ` · ${priceLabel(listed.price)}`}
						</p>
					)}
					{list && !list.error && list.models.length === 0 && (
						<p className="text-muted-foreground">
							{label} listed no models. Type a model id.
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

/** When the server function itself fails, as opposed to the provider's listing. */
const unreachable: ModelList = {
	models: [],
	error: "Could not load the model list.",
};

/**
 * A provider and model chooser: providers limited to those with credentials,
 * models from the provider's listing (reused briefly, refreshable), and any
 * typed id accepted. Controlled: the parent holds the selection.
 */
export function ModelPicker(props: {
	providers: AiProviderName[];
	value: AiSelection;
	onChange: (value: AiSelection) => void;
	disabled?: boolean;
}) {
	const queryClient = useQueryClient();
	const list = useServerFn(listModelsFn);
	const [refreshing, setRefreshing] = useState(false);
	const provider = props.value.provider;
	const key = ["models", provider];
	const { data, isFetching, isError } = useQuery({
		queryKey: key,
		queryFn: () => list({ data: { provider } }),
		// The server caches listings too; this only avoids refetching on every open.
		staleTime: 5 * 60 * 1000,
		retry: false,
	});
	const refresh = async () => {
		setRefreshing(true);
		try {
			queryClient.setQueryData(
				key,
				await list({ data: { provider, refresh: true } }),
			);
		} catch {
			queryClient.setQueryData(key, unreachable);
		} finally {
			setRefreshing(false);
		}
	};
	return (
		<ModelPickerView
			{...props}
			list={isError && !data ? unreachable : data}
			loading={isFetching || refreshing}
			onRefresh={refresh}
		/>
	);
}

/** A draft for the picker: `selection` when its provider is offered, else the first provider. */
export function initialDraft(
	providers: AiProviderName[],
	selection: AiSelection | null,
): AiSelection {
	return selection && providers.includes(selection.provider)
		? selection
		: { provider: providers[0] ?? "openai", model: "" };
}

/**
 * The default model or one of the reader's own: `value` null follows
 * `fallback` (the default, when available). Shows the default with a change
 * button, or the picker with a way back to the default. Without a default
 * the picker is shown and a model must be typed.
 */
export function ModelChoice({
	providers,
	fallback,
	value,
	onChange,
	disabled = false,
}: {
	providers: AiProviderName[];
	/** The default in effect; null when none is set or its provider is unavailable. */
	fallback: AiSelection | null;
	value: AiSelection | null;
	onChange: (value: AiSelection | null) => void;
	disabled?: boolean;
}) {
	if (value === null && fallback) {
		return (
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span data-testid="model-choice">
					{selectionLabel(fallback)}{" "}
					<span className="text-muted-foreground">(default)</span>
				</span>
				<Button
					type="button"
					variant="outline"
					size="xs"
					disabled={disabled}
					onClick={() => onChange(initialDraft(providers, fallback))}
				>
					Change
				</Button>
			</div>
		);
	}
	return (
		<div className="space-y-2">
			<ModelPicker
				providers={providers}
				value={value ?? initialDraft(providers, null)}
				onChange={onChange}
				disabled={disabled}
			/>
			{fallback && (
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={disabled}
					onClick={() => onChange(null)}
				>
					Use default ({selectionLabel(fallback)})
				</Button>
			)}
		</div>
	);
}

/** A stored reply's or run's model for display; the provider is missing on older rows. */
export function replyModelLabel(
	provider: string | null,
	model: string | null,
): string | null {
	if (!model) return null;
	const known = (Object.keys(PROVIDER_LABELS) as AiProviderName[]).find(
		(p) => p === provider,
	);
	return known ? selectionLabel({ provider: known, model }) : model;
}
