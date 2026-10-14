import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	createRetrieval,
	getSectionView,
	searchInput,
} from "#/modules/retrieval";
import { appContext } from "#/server/context";
import { runSearch } from "#/server/retrieval";

// Only server functions are exported here: anything else would pull server code into the client bundle.

export const searchPassagesFn = createServerFn({ method: "GET" })
	.validator(searchInput)
	.handler(({ data }) => runSearch(data));

export const resolveLocatorFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			locator: z.string().max(200),
			context: z.number().int().min(0).max(50).default(0),
		}),
	)
	.handler(({ data }) =>
		createRetrieval(appContext().db).resolve(data.locator, {
			context: data.context,
		}),
	);

export const getSectionViewFn = createServerFn({ method: "GET" })
	.validator(z.object({ locator: z.string().max(200) }))
	.handler(({ data }) => getSectionView(appContext().db, data.locator));
