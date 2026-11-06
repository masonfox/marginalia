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
