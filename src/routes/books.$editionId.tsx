import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { BookHeader, BookTabs } from "#/components/book-page";
import { getEditionFn } from "#/fns/library";

/**
 * The book page: one header and tab bar shared by every tab (Discuss, Guide,
 * Contents, About), mounted once so switching tabs neither remounts nor
 * refetches them.
 */
export const Route = createFileRoute("/books/$editionId")({
	loader: async ({ params }) => {
		if (!z.uuid().safeParse(params.editionId).success) throw notFound();
		const data = await getEditionFn({ data: { editionId: params.editionId } });
		if (!data) throw notFound();
		return data;
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `${loaderData.edition.title} · Marginalia`
					: "Marginalia",
			},
		],
	}),
	component: BookLayout,
});

function BookLayout() {
	return (
		<main className="mx-auto max-w-6xl px-4 py-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:py-8">
			<BookHeader />
			<div className="mt-6 min-w-0 lg:mt-0">
				<BookTabs />
				<div className="mt-6">
					<Outlet />
				</div>
			</div>
		</main>
	);
}
