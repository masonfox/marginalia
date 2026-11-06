import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isValidShelfCursor } from "#/lib/shelf-cursor";
import { MAX_SHELF_QUERY, SHELF_FILTERS } from "#/lib/shelf-status";
import { countPassages, getToc } from "#/modules/catalog";
import { pruneEmptyConversations } from "#/modules/conversation";
import { PARSER_VERSION } from "#/modules/epub";
import {
	deleteEdition,
	getEditionDetail,
	listEditions,
	reparseOutdated,
	requestRescan,
	retryImport,
} from "#/modules/library";
import { listReadingShelf, listShelf, SHELF_PAGE_SIZE } from "#/modules/shelf";
import { appContext } from "#/server/context";

/** What every page's shell needs. Never includes the password itself. */
export const getShellInfo = createServerFn({ method: "GET" }).handler(() => {
	const { config, access } = appContext();
	return {
		authEnabled: access.password.enabled,
		maxUploadMb: config.maxUploadMb,
		hasLibraryPaths: config.libraryPaths.length > 0,
	};
});

export const listEditionsFn = createServerFn({ method: "GET" }).handler(() =>
	listEditions(appContext().db),
);

export const listShelfInput = z.object({
	q: z.string().max(MAX_SHELF_QUERY).optional(),
	status: z.enum(SHELF_FILTERS).optional(),
	cursor: z
		.string()
		// The cursor embeds the last book's lowercased title, which has no
		// length limit, so this cap must comfortably exceed any realistic title.
		.max(65_536)
		.refine(isValidShelfCursor, "Invalid cursor")
		.optional(),
});

/** One page of the library list, with the search, status filter, and counts. */
export const listShelfFn = createServerFn({ method: "GET" })
	.validator(listShelfInput)
	.handler(({ data }) =>
		listShelf(appContext().db, { ...data, limit: SHELF_PAGE_SIZE }),
	);

/** Books on the dashboard's Reading section. */
export const READING_SHELF_LIMIT = 4;

/**
 * The books being read, most recently updated position first, and the
 * library's edition count, for the dashboard.
 */
export const listReadingShelfFn = createServerFn({ method: "GET" }).handler(
	() => listReadingShelf(appContext().db, { limit: READING_SHELF_LIMIT }),
);

export const getEditionFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => {
		const { db } = appContext();
		const edition = await getEditionDetail(db, data.editionId);
		if (!edition) return null;
		return {
			edition,
			toc: await getToc(db, data.editionId),
			passageCount: await countPassages(db, data.editionId),
			currentParserVersion: PARSER_VERSION,
		};
	});

export const rescanLibrary = createServerFn({ method: "POST" })
	.validator(z.object({ full: z.boolean().default(false) }))
	.handler(async ({ data }) => requestRescan(appContext().enqueue, data));

export const retryFailedImport = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => {
		const { db, enqueue } = appContext();
		return retryImport(db, enqueue, data.editionId);
	});

export const reparseEditions = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid().optional() }))
	.handler(async ({ data }) => {
		const { db, enqueue } = appContext();
		return reparseOutdated(db, enqueue, PARSER_VERSION, data.editionId);
	});

/**
 * Permanently deletes a book; an already deleted book counts as done.
 * Conversations left with no book are deleted with it.
 */
export const deleteEditionFn = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => {
		const { db, config, log, cancelJob } = appContext();
		const result = await deleteEdition(db, config.dataDir, data.editionId, log);
		await pruneEmptyConversations(db, (conversationId) =>
			cancelJob("conversation.title", { conversationId }),
		);
		return { deleted: result.deleted };
	});
