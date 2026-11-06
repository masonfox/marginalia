import {
	createFileRoute,
	notFound,
	Outlet,
	useMatchRoute,
} from "@tanstack/react-router";
import { z } from "zod";
import { BookHero } from "#/components/book-page";
import { getEditionFn } from "#/fns/library";

/**
 * The book page: one hero and tab bar shared by every tab (Discuss, Guide,
 * Contents, About), mounted once so switching tabs neither remounts nor
 * refetches them. Discuss and Contents get the full hero; the Guide and About
 * the compact one, so their content leads.
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
	const matchRoute = useMatchRoute();
	const compact =
		Boolean(matchRoute({ to: "/books/$editionId/guide", fuzzy: true })) ||
		Boolean(matchRoute({ to: "/books/$editionId/about" }));
	return (
		<main>
			<BookHero variant={compact ? "compact" : "full"} />
			<div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
				<Outlet />
			</div>
		</main>
	);
}
