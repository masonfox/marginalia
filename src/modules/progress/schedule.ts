// Recurring provider syncs (design D7). pg-boss keeps schedules in the
// database, so saving settings in any process changes them without a
// restart; workers fire them once across all instances.
import type { Executor } from "#/server/db";
import type { ScheduleJob } from "#/server/jobs/kinds";
import {
	type ProviderConfigInput,
	type ProviderConfigSaveResult,
	saveProviderConfig,
} from "./config-store";
import { listProviders } from "./registry";
import { progressProviders } from "./schema";
import type { ProviderKind, SyncSchedule } from "./types";

/** Cron expressions for the interval presets. */
export const SYNC_CRON: Readonly<
	Record<Exclude<SyncSchedule, "manual">, string>
> = {
	"1h": "0 * * * *",
	"6h": "0 */6 * * *",
	"24h": "30 3 * * *",
};

/** The cron a provider syncs on, or null when it syncs only on request. */
export function syncCron(
	enabled: boolean,
	schedule: SyncSchedule,
): string | null {
	return enabled && schedule !== "manual" ? SYNC_CRON[schedule] : null;
}

/** Sets or removes a provider's recurring `progress-sync`, keyed by its kind. */
export async function applySyncSchedule(
	scheduleJob: ScheduleJob,
	kind: ProviderKind,
	enabled: boolean,
	schedule: SyncSchedule,
): Promise<void> {
	await scheduleJob("progress-sync", kind, syncCron(enabled, schedule), {
		kind,
	});
}

/** Brings every provider's recurring sync in line with its stored settings. */
export async function reconcileSyncSchedules(
	db: Executor,
	scheduleJob: ScheduleJob,
): Promise<void> {
	const rows = await db
		.select({
			kind: progressProviders.kind,
			enabled: progressProviders.enabled,
			schedule: progressProviders.schedule,
		})
		.from(progressProviders);
	for (const { kind } of listProviders()) {
		const row = rows.find((r) => r.kind === kind);
		await applySyncSchedule(
			scheduleJob,
			kind,
			row?.enabled ?? false,
			row?.schedule ?? "manual",
		);
	}
}

/**
 * Saves a provider's settings and applies its schedule at once. Server
 * functions use this rather than `saveProviderConfig`.
 */
export async function saveProviderSettings(
	deps: { db: Executor; secret: string; scheduleJob: ScheduleJob },
	kind: ProviderKind,
	input: ProviderConfigInput,
): Promise<ProviderConfigSaveResult> {
	const result = await saveProviderConfig(deps.db, deps.secret, kind, input);
	if (result.status === "ok")
		await applySyncSchedule(
			deps.scheduleJob,
			kind,
			result.provider.enabled,
			result.provider.schedule,
		);
	return result;
}
