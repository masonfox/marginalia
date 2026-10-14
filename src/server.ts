import {
	createServerEntry,
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import { boot } from "./server/boot";
import { handleRequest } from "./server/request";

// Migrations, the job queue, and startup tasks finish before any request is served.
const ctx = await boot();
const startHandler = createStartHandler(defaultStreamHandler);

export default createServerEntry({
	fetch: (request, ...rest) =>
		handleRequest(request, ctx, (req) => startHandler(req, ...rest)),
});
