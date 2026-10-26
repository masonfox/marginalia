import { describe, expect, it, vi } from "vitest";
import { enqueueAutoPreprocess } from "./handlers";

// Enqueuing with the preprocessing default is covered in handlers.int.test.ts.
const run = (auto: boolean, enabled: boolean) => {
	const enqueue = vi.fn(async () => "job");
	return enqueueAutoPreprocess(
		{
			// Neither case reaches the database.
			db: {} as never,
			config: { preprocessAuto: auto },
			ai: {
				available: async () => (enabled ? ["openai"] : []),
			},
			enqueue,
			log: { warn: vi.fn() },
		},
		"ed1",
	).then((r) => ({ r, enqueue }));
};

describe("auto preprocess hook", () => {
	it("skips when auto is off", async () => {
		const { r, enqueue } = await run(false, true);
		expect(r).toBe(false);
		expect(enqueue).not.toHaveBeenCalled();
	});
	it("skips when AI is unconfigured", async () => {
		const { r, enqueue } = await run(true, false);
		expect(r).toBe(false);
		expect(enqueue).not.toHaveBeenCalled();
	});
});
