import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { countPassages, getToc } from "#/modules/catalog";
import { PARSER_VERSION } from "#/modules/epub";
import {
	getEditionDetail,
	listEditions,
	reparseOutdated,
	requestRescan,
	retryImport,
} from "#/modules/library";
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
