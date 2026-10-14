import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

function capture() {
	const lines: string[] = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			lines.push(...String(chunk).split("\n").filter(Boolean));
			cb();
		},
	});
	return { lines, stream };
}

describe("createLogger", () => {
	it("writes one JSON object per line", () => {
		const { lines, stream } = capture();
		const log = createLogger("info", stream);
		log.info({ editionId: "e1" }, "ingested");
		log.warn("careful");
		expect(lines).toHaveLength(2);
		const first = JSON.parse(lines[0] as string);
		expect(first).toMatchObject({
			level: 30,
			app: "marginalia",
			editionId: "e1",
			msg: "ingested",
		});
		expect(typeof first.time).toBe("string");
	});

	it("respects the level", () => {
		const { lines, stream } = capture();
		const log = createLogger("warn", stream);
		log.info("hidden");
		log.debug("hidden");
		log.error("shown");
		expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["shown"]);
	});

	it("logs JSON from the process logger in production", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("DATABASE_URL", "postgres://localhost/m");
		vi.stubEnv("LOG_LEVEL", "info");
		vi.resetModules();
		const written: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk: string | Uint8Array) => {
				written.push(String(chunk));
				return true;
			});
		try {
			const { getLogger } = await import("./logger");
			getLogger().info({ k: 1 }, "production line");
			getLogger().flush();
		} finally {
			spy.mockRestore();
			vi.unstubAllEnvs();
		}
		const line = written.join("").trim().split("\n").at(-1) as string;
		expect(JSON.parse(line)).toMatchObject({ msg: "production line", k: 1 });
	});

	it("redacts password fields", () => {
		const { lines, stream } = capture();
		createLogger("info", stream).info({ password: "hunter2" }, "x");
		expect(lines[0]).not.toContain("hunter2");
	});
});
