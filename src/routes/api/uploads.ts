import { createFileRoute } from "@tanstack/react-router";
import { handleUploadRequest } from "#/modules/library";
import { appContext } from "#/server/context";

export const Route = createFileRoute("/api/uploads")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { db, config, enqueue, log } = appContext();
				return handleUploadRequest(request, {
					db,
					dataDir: config.dataDir,
					maxUploadMb: config.maxUploadMb,
					publicUrl: config.publicUrl,
					enqueue,
					log,
				});
			},
		},
	},
});
