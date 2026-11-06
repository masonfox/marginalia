import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NamingPatch } from "#/modules/conversation";
import { NamingPoller } from "./naming-poller";

const id = "00000000-0000-4000-8000-000000000001";
const source = (state = "pending", expires = 5000) => ({
	id,
	title: "Provisional",
	naming: {
		state: state as "pending",
		locked: false,
		expiresAt: new Date(expires),
		deadline: new Date(expires),
		revision: 1,
	},
});
const patch = (
	state = "pending",
	title = "Provisional",
	revision = 1,
): NamingPatch => ({
	...source(state),
	title,
	naming: { ...source(state).naming, revision },
	usageTotal: {} as NamingPatch["usageTotal"],
	namingUsage: { rows: [], missing: false, incomplete: false, unknown: false },
});
const flush = async () => {
	await vi.advanceTimersByTimeAsync(0);
};
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
});
afterEach(() => {
	vi.useRealTimers();
});
describe("shared bounded naming polling", () => {
	it("deduplicates mounted surfaces and updates after reply completion independently", async () => {
		const fetch = vi.fn(async () => [patch()]);
		const poller = new NamingPoller(fetch);
		const notify = vi.fn();
		const off = poller.subscribe(source(), notify);
		const off2 = poller.subscribe(source(), vi.fn());
		await flush();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith([id], expect.any(AbortSignal));
		fetch.mockResolvedValue([patch("succeeded", "Generated title", 3)]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(poller.get(id)?.title).toBe("Generated title");
		expect(notify).toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(fetch).toHaveBeenCalledTimes(2);
		off();
		off2();
	});
	it("retries transient failures only within the deadline, makes one final attempt, and cleans up", async () => {
		const fetch = vi.fn(async (): Promise<NamingPatch[]> => {
			throw new Error("offline");
		});
		const poller = new NamingPoller(fetch);
		const off = poller.subscribe(source(), vi.fn());
		await flush();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetch).toHaveBeenCalledTimes(6);
		off();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("pauses hidden tabs and reconciles on visibility/focus/reconnect", async () => {
		let visible = false;
		const fetch = vi.fn(async () => [patch()]);
		const poller = new NamingPoller(fetch, () => visible);
		const off = poller.subscribe(source(), vi.fn());
		await flush();
		expect(fetch).not.toHaveBeenCalled();
		visible = true;
		poller.reconcile();
		await flush();
		expect(fetch).toHaveBeenCalledTimes(1);
		visible = false;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetch).toHaveBeenCalledTimes(1);
		visible = true;
		fetch.mockResolvedValue([patch("succeeded", "Finished", 3)]);
		poller.reconcile();
		await flush();
		expect(poller.get(id)?.title).toBe("Finished");
		off();
	});
	it("stops tracking deleted ids and cancels timers on unmount", async () => {
		const fetch = vi.fn(async () => []);
		const poller = new NamingPoller(fetch);
		const off = poller.subscribe(source(), vi.fn());
		await flush();
		expect(poller.isDeleted(id)).toBe(true);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetch).toHaveBeenCalledTimes(1);
		off();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("discards a stale in-flight response after successful same-string manual rename", async () => {
		let resolve!: (p: NamingPatch[]) => void;
		const fetch = vi.fn(
			() =>
				new Promise<NamingPatch[]>((r) => {
					resolve = r;
				}),
		);
		const poller = new NamingPoller(fetch);
		const off = poller.subscribe(source(), vi.fn());
		await flush();
		poller.renamed(id, "Provisional");
		resolve([patch("succeeded", "Stale generated", 2)]);
		await flush();
		expect(poller.get(id)?.title).toBe("Provisional");
		expect(poller.get(id)?.naming.locked).toBe(true);
		off();
	});
	it("chunks more than 100 ids without changing caller lists or cursors", async () => {
		const fetch = vi.fn(async (ids: string[]) =>
			ids.map((id) => ({ ...patch("succeeded", "Generated", 3), id })),
		);
		const poller = new NamingPoller(fetch);
		const rows = Array.from({ length: 205 }, (_, i) => ({
			...source(),
			id: `id-${i}`,
		}));
		const before = JSON.stringify(rows);
		const off = rows.map((row) => poller.subscribe(row, vi.fn()));
		await flush();
		expect(fetch.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 5]);
		expect(JSON.stringify(rows)).toBe(before);
		off.forEach((f) => {
			f();
		});
	});
	it("extends pending tracking only for the persisted running deadline", async () => {
		const fetch = vi.fn(async () => [patch()]);
		const poller = new NamingPoller(fetch);
		const off = poller.subscribe(source("pending", 1000), vi.fn());
		await flush();
		fetch.mockResolvedValue([
			{
				...patch("running"),
				naming: {
					...patch("running").naming,
					deadline: new Date(4000),
					revision: 2,
				},
			},
		]);
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetch).toHaveBeenCalledTimes(5);
		off();
	});
});

it("aborts a hung network request and leaves no polling after deadline or unmount", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const signals: AbortSignal[] = [];
	const fetch = vi.fn((_ids: string[], signal: AbortSignal) => {
		signals.push(signal);
		return new Promise<NamingPatch[]>(() => {});
	});
	const poller = new NamingPoller(fetch);
	const off = poller.subscribe(source(), vi.fn());
	await flush();
	await vi.advanceTimersByTimeAsync(12_000);
	expect(signals.every((s) => s.aborted)).toBe(true);
	expect(fetch).toHaveBeenCalledTimes(2);
	off();
	await flush();
	expect(vi.getTimerCount()).toBe(0);
});

it("starts tracking a newer pending loader revision after an earlier eligible mount", async () => {
	const eligible = {
		...source("eligible"),
		naming: { ...source().naming, state: "eligible" as const, revision: 0 },
	};
	const fetch = vi.fn(
		async (): Promise<NamingPatch[]> => [
			{
				...patch("eligible"),
				naming: { ...patch().naming, state: "eligible" as const, revision: 0 },
			},
		],
	);
	const poller = new NamingPoller(fetch);
	const off = poller.subscribe(eligible, vi.fn());
	await flush();
	expect(fetch).toHaveBeenCalledTimes(1);
	fetch.mockResolvedValue([patch()]);
	poller.seed(source());
	await flush();
	expect(fetch).toHaveBeenCalledTimes(2);
	await vi.advanceTimersByTimeAsync(1000);
	expect(fetch).toHaveBeenCalledTimes(3);
	off();
});

describe("claimed-attempt accounting after manual rename", () => {
	const running = {
		...source("running"),
		naming: {
			...source("running").naming,
			deadline: new Date(4000),
			revision: 2,
		},
	};
	const renamedPatch = (
		revision: number,
		missing: boolean,
		inputTokens: number,
		deadline: Date | null = new Date(4000),
	): NamingPatch => ({
		id,
		title: "Mine",
		naming: {
			state: "skipped",
			locked: true,
			expiresAt: new Date(5000),
			deadline,
			revision,
		},
		usageTotal: { inputTokens } as unknown as NamingPatch["usageTotal"],
		namingUsage: { rows: [], missing, incomplete: missing, unknown: missing },
	});
	it("keeps polling after rename until the delayed accounting-only revision arrives", async () => {
		let resolveStale!: (p: NamingPatch[]) => void;
		const fetch = vi.fn(
			(): Promise<NamingPatch[]> =>
				new Promise((r) => {
					resolveStale = r;
				}),
		);
		const poller = new NamingPoller(fetch);
		const notify = vi.fn();
		const off = poller.subscribe(running, notify);
		await flush();
		const stale = resolveStale;
		fetch.mockResolvedValue([renamedPatch(3, true, 10)]);
		poller.renamed(id, "Mine");
		// A pre-rename response cannot replace the manual title or its revision.
		stale([{ ...patch("succeeded", "Generated", 3) }]);
		await flush();
		expect(poller.get(id)?.title).toBe("Mine");
		expect(poller.get(id)?.naming.revision).toBe(3);
		expect(poller.get(id)?.namingUsage.missing).toBe(true);
		const calls = fetch.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetch.mock.calls.length).toBe(calls + 1);
		fetch.mockResolvedValue([renamedPatch(4, false, 25)]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(poller.get(id)?.naming.revision).toBe(4);
		expect(poller.get(id)?.title).toBe("Mine");
		expect(poller.get(id)?.naming.locked).toBe(true);
		expect(poller.get(id)?.namingUsage.missing).toBe(false);
		expect(
			(poller.get(id)?.usageTotal as unknown as { inputTokens: number })
				.inputTokens,
		).toBe(25);
		const settled = fetch.mock.calls.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetch).toHaveBeenCalledTimes(settled);
		off();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("stops at the persisted deadline when the claimed attempt never saves usage", async () => {
		const fetch = vi.fn(
			async (): Promise<NamingPatch[]> => [{ ...patch("running"), ...running }],
		);
		const poller = new NamingPoller(fetch);
		const off = poller.subscribe(running, vi.fn());
		await flush();
		fetch.mockResolvedValue([renamedPatch(3, true, 10)]);
		poller.renamed(id, "Mine");
		await flush();
		const times: number[] = [];
		fetch.mockImplementation(async () => {
			times.push(Date.now());
			return [renamedPatch(3, true, 10)];
		});
		await vi.advanceTimersByTimeAsync(20_000);
		// ~1s polling until the 4s deadline, then exactly one final fetch at it.
		expect(times).toEqual([1000, 2000, 3000, 4000]);
		const stopped = fetch.mock.calls.length;
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetch).toHaveBeenCalledTimes(stopped);
		expect(poller.get(id)?.title).toBe("Mine");
		expect(vi.getTimerCount()).toBe(0);
		off();
	});
	it("reconciles accounting saved between the last periodic poll and the deadline", async () => {
		const fetch = vi.fn(
			async (): Promise<NamingPatch[]> => [{ ...patch("running"), ...running }],
		);
		const poller = new NamingPoller(fetch);
		const off = poller.subscribe(running, vi.fn());
		await flush();
		fetch.mockResolvedValue([renamedPatch(3, true, 10)]);
		poller.renamed(id, "Mine");
		await flush();
		await vi.advanceTimersByTimeAsync(3000);
		expect(poller.get(id)?.namingUsage.missing).toBe(true);
		const beforeDeadline = fetch.mock.calls.length;
		// Usage commits at 3.5s, after the 3s poll but before the 4s deadline.
		await vi.advanceTimersByTimeAsync(500);
		fetch.mockResolvedValue([renamedPatch(4, false, 25)]);
		await vi.advanceTimersByTimeAsync(500);
		expect(fetch).toHaveBeenCalledTimes(beforeDeadline + 1);
		expect(poller.get(id)?.naming.revision).toBe(4);
		expect(poller.get(id)?.title).toBe("Mine");
		expect(poller.get(id)?.naming.locked).toBe(true);
		expect(poller.get(id)?.namingUsage.missing).toBe(false);
		expect(
			(poller.get(id)?.usageTotal as unknown as { inputTokens: number })
				.inputTokens,
		).toBe(25);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetch).toHaveBeenCalledTimes(beforeDeadline + 1);
		expect(vi.getTimerCount()).toBe(0);
		off();
	});
	it("does not poll after rename when no attempt was claimed", async () => {
		const fetch = vi.fn(async () => [patch()]);
		const poller = new NamingPoller(fetch);
		const off = poller.subscribe(source(), vi.fn());
		await flush();
		fetch.mockResolvedValue([renamedPatch(2, false, 0, null)]);
		poller.renamed(id, "Mine");
		await flush();
		const after = fetch.mock.calls.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetch).toHaveBeenCalledTimes(after);
		expect(poller.get(id)?.naming.state).toBe("skipped");
		expect(vi.getTimerCount()).toBe(0);
		off();
	});
});
