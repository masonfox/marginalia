import { createFileRoute } from "@tanstack/react-router";
import { appContext } from "#/server/context";
import { healthResponse } from "#/server/health";

export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: () => healthResponse(appContext().db),
		},
	},
});
