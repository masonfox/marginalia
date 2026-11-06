// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NamingPatch } from "#/modules/conversation";
import {
	namingPoller,
	namingRenamed,
	useNamingMetadata,
} from "./use-naming-metadata";

const mocks = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock("#/fns/conversations", () => ({
	getNamingMetadataFn: (...args: unknown[]) => mocks.metadata(...args),
}));
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const original = {
	id: "header-test",
	title: "Provisional",
	messages: ["Persisted user message"],
	naming: {
		state: "pending" as const,
		locked: false,
		expiresAt: new Date(Date.now() + 60_000),
		deadline: null,
		revision: 1,
	},
	usageTotal: { inputTokens: 20 },
};
const patch = {
	id: original.id,
	title: "Generated",
	naming: { ...original.naming, state: "succeeded", revision: 3 },
	namingUsage: { rows: [], missing: false, unknown: false, incomplete: false },
	usageTotal: { inputTokens: 30 },
} as unknown as NamingPatch;
function View({ source = original }: { source?: typeof original }) {
	const metadata = useNamingMetadata(source);
	const [draft, setDraft] = useState("Typed unsent draft");
	const [stream, setStream] = useState("Streaming reply");
	return (
		<>
			<h1>{metadata.title}</h1>
			<input value={draft} onChange={(e) => setDraft(e.target.value)} />
			<p>{stream}</p>
			<button type="button" onClick={() => setStream((s) => `${s} continued`)}>
				Stream delta
			</button>
			<output>{metadata.usageTotal.inputTokens}</output>
			<span>{source.messages.join(",")}</span>
		</>
	);
}
beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	mocks.metadata.mockReset();
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
});
const settle = async () => {
	for (let i = 0; i < 3; i++)
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
};
describe("metadata-only header updates", () => {
	it("updates title and naming usage without reseeding live reply state or clearing the draft", async () => {
		let resolve!: (p: NamingPatch[]) => void;
		mocks.metadata.mockImplementation(
			() =>
				new Promise<NamingPatch[]>((r) => {
					resolve = r;
				}),
		);
		await act(async () => root.render(<View />));
		await settle();
		const messages = original.messages;
		await act(async () => {
			resolve([patch]);
		});
		await settle();
		expect(container.querySelector("h1")?.textContent).toBe("Generated");
		expect(container.querySelector("input")?.value).toBe("Typed unsent draft");
		expect(container.querySelector("output")?.textContent).toBe("30");
		expect(original.messages).toBe(messages);
		await act(async () => container.querySelector("button")?.click());
		expect(container.textContent).toContain("Streaming reply continued");
		// A later reply loader at the same naming revision has newer independent totals.
		await act(async () =>
			root.render(
				<View
					source={{
						...original,
						naming: patch.naming as typeof original.naming,
						usageTotal: { inputTokens: 50 },
					}}
				/>,
			),
		);
		expect(container.querySelector("output")?.textContent).toBe("50");
		expect(container.textContent).toContain("Streaming reply continued");
		expect(container.querySelector("input")?.value).toBe("Typed unsent draft");
	});
	it("successful manual rename invalidates an older pending metadata response", async () => {
		let resolve!: (p: NamingPatch[]) => void;
		mocks.metadata.mockImplementation(
			() =>
				new Promise<NamingPatch[]>((r) => {
					resolve = r;
				}),
		);
		await act(async () => root.render(<View />));
		await settle();
		await act(async () => {
			namingRenamed(original.id, "My title");
			resolve([patch]);
		});
		await settle();
		expect(container.querySelector("h1")?.textContent).toBe("My title");
		expect(container.querySelector("input")?.value).toBe("Typed unsent draft");
	});
	it("focus/reconnect reconciliation preserves fresh reply totals at an unchanged naming revision", async () => {
		mocks.metadata.mockResolvedValue([patch]);
		await act(async () =>
			root.render(
				<View
					source={{
						...original,
						naming: patch.naming as typeof original.naming,
						usageTotal: { inputTokens: 55 },
					}}
				/>,
			),
		);
		await settle();
		await act(async () => {
			window.dispatchEvent(new Event("online"));
			window.dispatchEvent(new Event("focus"));
			namingPoller.reconcile();
		});
		await settle();
		expect(container.querySelector("output")?.textContent).toBe("55");
	});
});
