import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_SHELF_QUERY } from "#/lib/shelf-status";
import {
	enqueueProviderSync,
	getProviderConfig,
	linkBookByHand,
	listProviderSettings,
	listUnmatched,
	PROVIDER_KINDS,
	SYNC_SCHEDULES,
	saveProviderSettings,
	setProviderOrder,
	testProviderConnection,
	unlink,
} from "#/modules/progress";
import { listShelf } from "#/modules/shelf";
import { appContext } from "#/server/context";

// Server functions for Settings' "Reading sync" section. Secrets never come
// back: provider views carry hints only (progress config-store).

const kind = z.enum(PROVIDER_KINDS);
const values = z.record(z.string(), z.string().max(4000));

/** Every provider in priority order, with its form fields, help and status. */
export const listSyncProvidersFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const { db, config } = appContext();
		return listProviderSettings(db, config.secretKey);
	},
);

/**
 * Saves a provider's form. Blank secrets keep the saved value. The schedule
 * takes effect at once.
 */
export const saveSyncProviderFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			kind,
			values: values.optional(),
			enabled: z.boolean().optional(),
			schedule: z.enum(SYNC_SCHEDULES).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const { db, config, scheduleJob } = appContext();
		const deps = { db, secret: config.secretKey, scheduleJob };
		// Values first, so turning on can require every field, saved or in this form.
		const result = await saveProviderSettings(deps, data.kind, {
			values: data.values,
			schedule: data.schedule,
		});
		if (result.status !== "ok" || data.enabled === undefined) return result;
		if (
			data.enabled &&
			(!result.provider.configured || result.provider.unreadable)
		)
			return {
				status: "invalid" as const,
				message: `Fill in ${result.provider.label}'s required settings before turning it on.`,
			};
		return saveProviderSettings(deps, data.kind, { enabled: data.enabled });
	});

/** Turns a provider on or off; a provider missing required settings stays off. */
export const setSyncProviderEnabledFn = createServerFn({ method: "POST" })
	.validator(z.object({ kind, enabled: z.boolean() }))
	.handler(async ({ data }) => {
		const { db, config, scheduleJob } = appContext();
		if (data.enabled) {
			const current = await getProviderConfig(db, config.secretKey, data.kind);
			if (!current.configured || current.unreadable)
				return {
					status: "invalid" as const,
					message: `Fill in ${current.label}'s required settings before turning it on.`,
				};
		}
		return saveProviderSettings(
			{ db, secret: config.secretKey, scheduleJob },
			data.kind,
			{ enabled: data.enabled },
		);
	});

/** Sets a provider's sync schedule; it takes effect without a restart. */
export const setSyncScheduleFn = createServerFn({ method: "POST" })
	.validator(z.object({ kind, schedule: z.enum(SYNC_SCHEDULES) }))
	.handler(async ({ data }) => {
		const { db, config, scheduleJob } = appContext();
		return saveProviderSettings(
			{ db, secret: config.secretKey, scheduleJob },
			data.kind,
			{ schedule: data.schedule },
		);
	});

/** Sets the priority order, highest first; it must name every provider once. */
export const reorderSyncProvidersFn = createServerFn({ method: "POST" })
	.validator(z.object({ order: z.array(kind).max(PROVIDER_KINDS.length) }))
	.handler(async ({ data }) => setProviderOrder(appContext().db, data.order));

/**
 * Tests a provider with the form's unsaved values over its saved settings;
 * a blank secret uses the saved one. Stores nothing.
 */
export const testSyncProviderFn = createServerFn({ method: "POST" })
	.validator(z.object({ kind, values: values.optional() }))
	.handler(async ({ data }) => {
		const { db, config } = appContext();
		return testProviderConnection(
			db,
			config.secretKey,
			data.kind,
			data.values ?? {},
		);
	});

/**
 * Queues a sync of one provider. `already-queued` when one is pending or
 * running; `disabled` when the provider is off or missing settings.
 */
export const syncProviderNowFn = createServerFn({ method: "POST" })
	.validator(z.object({ kind }))
	.handler(async ({ data }) => {
		const { db, config, enqueue } = appContext();
		const current = await getProviderConfig(db, config.secretKey, data.kind);
		if (!current.enabled || !current.configured || current.unreadable)
			return { status: "disabled" as const };
		const { queued } = await enqueueProviderSync(enqueue, data.kind);
		return {
			status: queued ? ("queued" as const) : ("already-queued" as const),
		};
	});

/** Provider books being read that no edition is linked to. */
export const listUnmatchedBooksFn = createServerFn({ method: "GET" }).handler(
	async () => listUnmatched(appContext().db),
);

/** Links a provider book to an edition by hand, replacing any other link of either. */
export const linkUnmatchedBookFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			kind,
			externalId: z.string().min(1).max(500),
			editionId: z.uuid(),
		}),
	)
	.handler(async ({ data }) =>
		linkBookByHand(appContext().db, data.kind, data.externalId, data.editionId),
	);

/**
 * Unlinks an edition from a provider. An automatic match is remembered as
 * rejected so sync does not link it again; a manual link is removed.
 */
export const unlinkBookFn = createServerFn({ method: "POST" })
	.validator(z.object({ kind, editionId: z.uuid() }))
	.handler(async ({ data }) => ({
		unlinked: await unlink(appContext().db, data.editionId, data.kind),
	}));

const EDITION_SEARCH_LIMIT = 20;

/** Editions matching a title or author search, for the link picker. */
export const searchEditionsFn = createServerFn({ method: "GET" })
	.validator(z.object({ q: z.string().max(MAX_SHELF_QUERY) }))
	.handler(async ({ data }) => {
		const page = await listShelf(appContext().db, {
			q: data.q,
			limit: EDITION_SEARCH_LIMIT,
		});
		return page.items.map(({ id, title, authors }) => ({ id, title, authors }));
	});
