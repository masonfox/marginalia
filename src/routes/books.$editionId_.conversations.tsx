import { createFileRoute, redirect } from "@tanstack/react-router";

/** The former conversation list: a book's conversations are on its Discuss tab now. */
export const Route = createFileRoute("/books/$editionId_/conversations")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/books/$editionId",
			params: { editionId: params.editionId },
			replace: true,
		});
	},
});
