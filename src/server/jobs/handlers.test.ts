import { describe, expect, it, vi } from "vitest";
import { enqueueAutoPreprocess } from "./handlers";

const run = (auto: boolean, enabled: boolean) => {
	const enqueue = vi.fn(async () => "job");
	return enqueueAutoPreprocess(
		{ config: { preprocessAuto: auto }, ai: { status: { enabled } }, enqueue },
		"ed1",
	).then((r) => ({ r, enqueue }));
};

describe("auto preprocess hook", () => {
	it("enqueues when AI is configured and auto is on", async () => {
		const { r, enqueue } = await run(true, true);
		expect(r).toBe(true);
		expect(enqueue).toHaveBeenCalledWith("analysis.preprocess", {
			editionId: "ed1",
		});
	});
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
