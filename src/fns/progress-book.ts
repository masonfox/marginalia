import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	enqueueBookSync,
	getProvider,
	getSyncStatus,
	setSyncExcluded,
} from "#/modules/progress";
import { appContext } from "#/server/context";

// Only server functions are exported here: anything else would pull server code into the client bundle.

const editionSchema = z.object({ editionId: z.uuid() });

/**
 * What the position control shows about the book's sync: the position's
 * source and the reading it came from (`sourceLabel` names the provider),
 * whether the book is excluded, whether it has an enabled linked provider,
 * and the state of a pending one-book sync. Null when the edition does not
 * exist.
 */
export const getBookSyncFn = createServerFn({ method: "GET" })
	.validator(editionSchema)
	.handler(async ({ data }) => {
		const { db, pendingJob } = appContext();
		const [status, pending] = await Promise.all([
			getSyncStatus(db, data.editionId),
			pendingJob("progress-sync-book", { editionId: data.editionId }),
		]);
		if (!status) return null;
		const { links, ...rest } = status;
		return {
			...rest,
			sourceLabel:
				rest.source && rest.source !== "manual"
					? getProvider(rest.source).label
					: null,
			linked: links.some((l) => l.enabled),
			pending,
		};
	});

/** Queues a sync of this one book. `queued` is false when one is already pending. */
export const syncBookFn = createServerFn({ method: "POST" })
	.validator(editionSchema)
	.handler(({ data }) => enqueueBookSync(appContext().enqueue, data.editionId));

/** Excludes the book from sync, or includes it again. */
export const setBookSyncExcludedFn = createServerFn({ method: "POST" })
	.validator(editionSchema.extend({ excluded: z.boolean() }))
	.handler(async ({ data }) => ({
		updated: await setSyncExcluded(
			appContext().db,
			data.editionId,
			data.excluded,
		),
	}));
