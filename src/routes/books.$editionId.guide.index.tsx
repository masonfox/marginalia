import { createFileRoute, redirect } from "@tanstack/react-router";

// Chapters is the Guide's default view.
export const Route = createFileRoute("/books/$editionId/guide/")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/books/$editionId/guide/chapters",
			params,
			replace: true,
		});
	},
});
