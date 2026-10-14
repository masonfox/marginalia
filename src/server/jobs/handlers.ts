import { purgeExpiredSessions } from "#/modules/access";
import { ingestEdition, reparseEdition } from "#/modules/catalog";
import { scanLibraries } from "#/modules/library";
import { appContext } from "../context";
import type { JobHandlers } from "./kinds";

/** Wires each job kind to the module that handles it. */
export function jobHandlers(): JobHandlers {
	const ingestDeps = () => {
		const { db, config, log } = appContext();
		return { db, dataDir: config.dataDir, log };
	};
	return {
		"library.scan": async ({ full }) => {
			const { db, config, enqueue, log } = appContext();
			await scanLibraries(
				{ db, libraryPaths: config.libraryPaths, enqueue, log },
				{ full },
			);
		},
		"library.ingest": async ({ sha256 }, ctx) => {
			await ingestEdition(ingestDeps(), sha256, ctx);
		},
		"catalog.reparse": async ({ editionId }, ctx) => {
			await reparseEdition(ingestDeps(), editionId, ctx);
		},
		"access.purge-sessions": async () => {
			const { db, log } = appContext();
			log.info(
				{ purged: await purgeExpiredSessions(db) },
				"expired sessions purged",
			);
		},
	};
}
