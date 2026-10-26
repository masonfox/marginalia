// The instance's AI defaults, saved only in Settings.
import { eq, sql } from "drizzle-orm";
import { type AiRuntime, selectionSchema } from "#/modules/ai";
import type { AiProviderName, AiSelection } from "#/server/config";
import type { Executor } from "#/server/db";
import { aiSettings } from "./schema";

export interface AiDefault {
	selection: AiSelection | null;
	/** Whether the selection's provider has credentials. False without a selection. */
	available: boolean;
}

export interface AiDefaults {
	chat: AiDefault;
	/**
	 * `sameAsChat` when preprocessing follows the chat default, whose
	 * selection it then carries.
	 */
	preprocess: AiDefault & { sameAsChat: boolean };
}

/** What the UI may know about the AI setup. Never contains keys or base URLs. */
export interface AiStatus extends AiDefaults {
	/** At least one provider has credentials. */
	enabled: boolean;
	providers: AiProviderName[];
}

export type SaveResult =
	| { status: "ok"; selection: AiSelection | null }
	| { status: "invalid"; message: string }
	| { status: "unavailable"; provider: AiProviderName };

type AiSource = Pick<AiRuntime, "available">;

/** Reads the current saved defaults on every call. */
export async function getAiDefaults(
	db: Executor,
	ai: AiSource,
): Promise<AiDefaults> {
	const [row] = await db.select().from(aiSettings).where(eq(aiSettings.id, 1));
	const providers = await ai.available();
	const withAvailability = (selection: AiSelection | null): AiDefault => ({
		selection,
		available: !!selection && providers.includes(selection.provider),
	});
	const chat = withAvailability(pair(row?.chatProvider, row?.chatModel));
	const own =
		row?.preprocessMode === "model"
			? pair(row.preprocessProvider, row.preprocessModel)
			: null;
	return {
		chat,
		preprocess: { ...(own ? withAvailability(own) : chat), sameAsChat: !own },
	};
}

/** Defaults plus the available providers, for the UI. */
export async function getAiStatus(
	db: Executor,
	ai: AiSource,
): Promise<AiStatus> {
	const providers = await ai.available();
	return {
		enabled: providers.length > 0,
		providers,
		...(await getAiDefaults(db, ai)),
	};
}

/** Saves the chat default. Refused when invalid or its provider has no credentials. */
export async function saveChatDefault(
	db: Executor,
	ai: AiSource,
	input: unknown,
): Promise<SaveResult> {
	const checked = await checkSelection(ai, input);
	if (checked.status !== "ok") return checked;
	await upsert(db, {
		chatProvider: checked.selection.provider,
		chatModel: checked.selection.model,
	});
	return checked;
}

/** Saves the preprocessing default: a selection, or "same-as-chat". */
export async function savePreprocessDefault(
	db: Executor,
	ai: AiSource,
	input: unknown,
): Promise<SaveResult> {
	if (input === "same-as-chat") {
		await upsert(db, {
			preprocessMode: "same-as-chat",
			preprocessProvider: null,
			preprocessModel: null,
		});
		return { status: "ok", selection: null };
	}
	const checked = await checkSelection(ai, input);
	if (checked.status !== "ok") return checked;
	await upsert(db, {
		preprocessMode: "model",
		preprocessProvider: checked.selection.provider,
		preprocessModel: checked.selection.model,
	});
	return checked;
}

/** Removes the saved chat default, leaving no chat default. */
export async function clearChatDefault(db: Executor): Promise<void> {
	await upsert(db, { chatProvider: null, chatModel: null });
}

/** Clears the preprocessing default to same as chat. */
export async function clearPreprocessDefault(db: Executor): Promise<void> {
	await upsert(db, {
		preprocessMode: null,
		preprocessProvider: null,
		preprocessModel: null,
	});
}

/** Validates a selection and requires its provider to have credentials. */
export async function checkSelection(
	ai: AiSource,
	input: unknown,
): Promise<
	| { status: "ok"; selection: AiSelection }
	| Exclude<SaveResult, { status: "ok" }>
> {
	const parsed = selectionSchema.safeParse(input);
	if (!parsed.success)
		return {
			status: "invalid",
			message: parsed.error.issues[0]?.message ?? "Invalid model selection.",
		};
	if (!(await ai.available()).includes(parsed.data.provider))
		return { status: "unavailable", provider: parsed.data.provider };
	return { status: "ok", selection: parsed.data };
}

async function upsert(
	db: Executor,
	values: Partial<typeof aiSettings.$inferInsert>,
): Promise<void> {
	await db
		.insert(aiSettings)
		.values({ id: 1, ...values })
		.onConflictDoUpdate({
			target: aiSettings.id,
			set: { ...values, updatedAt: sql`now()` },
		});
}

function pair(
	provider: AiProviderName | null | undefined,
	model: string | null | undefined,
): AiSelection | null {
	return provider && model ? { provider, model } : null;
}
