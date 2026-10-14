import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { getCoverPath } from "#/modules/library";
import { appContext } from "#/server/context";

const TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
};

export const Route = createFileRoute("/api/covers/$editionId")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const { db, config } = appContext();
				if (!/^[0-9a-f-]{36}$/.test(params.editionId)) {
					return new Response("Not found", { status: 404 });
				}
				const relative = await getCoverPath(db, params.editionId);
				if (!relative) return new Response("Not found", { status: 404 });
				try {
					const bytes = await readFile(path.join(config.dataDir, relative));
					const type =
						TYPES[path.extname(relative)] ?? "application/octet-stream";
					return new Response(new Uint8Array(bytes), {
						headers: {
							"content-type": type,
							"cache-control": "private, max-age=86400",
							// SVG covers come from untrusted EPUBs: never let them run script.
							"content-security-policy":
								"default-src 'none'; style-src 'unsafe-inline'",
							"x-content-type-options": "nosniff",
						},
					});
				} catch {
					return new Response("Not found", { status: 404 });
				}
			},
		},
	},
});
