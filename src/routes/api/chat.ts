import { createFileRoute } from "@tanstack/react-router";
import { handleChatRequest } from "#/modules/conversation";
import { appContext } from "#/server/context";

export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { db, ai, log } = appContext();
				return handleChatRequest(request, { db, ai, log });
			},
		},
	},
});
