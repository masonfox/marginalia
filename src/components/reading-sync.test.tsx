// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { ProviderSettingsView, UnmatchedBook } from "#/modules/progress";
import { ReadingSync, type ReadingSyncActions } from "./reading-sync";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const NOW = new Date("2026-11-07T12:00:00Z");

const hardcover: ProviderSettingsView = {
	kind: "hardcover",
	label: "Hardcover",
	saved: true,
	enabled: true,
	priority: 1,
	schedule: "6h",
	values: {},
	secrets: { token: { set: true, hint: "wxyz" } },
	configured: true,
	unreadable: false,
	lastSyncAt: new Date(NOW.getTime() - 3 * 3_600_000),
	lastSyncMatched: 12,
	lastError: "Hardcover is rate limiting requests. The sync will resume later.",
	configFields: [
		{
			key: "token",
			label: "API token",
			type: "secret",
			hint: "From hardcover.app.",
			required: true,
		},
	],
	help: "Copy your API token from Hardcover's account settings.",
	mode: "list",
};

const bookorbit: ProviderSettingsView = {
	kind: "bookorbit",
	label: "BookOrbit",
	saved: false,
	enabled: false,
	priority: null,
	schedule: "manual",
	values: {},
	secrets: { key: { set: false, hint: null } },
	configured: false,
	unreadable: false,
	lastSyncAt: null,
	lastSyncMatched: null,
	lastError: null,
	configFields: [
		{ key: "url", label: "Server URL", type: "url", required: true },
		{
			key: "username",
			label: "KOReader username",
			type: "text",
			required: true,
		},
		{ key: "key", label: "KOReader password", type: "secret", required: true },
	],
	help: "Use the KOReader sync account.",
	mode: "lookup",
};

const unmatched: UnmatchedBook[] = [
	{
		providerKind: "hardcover",
		externalId: "hc-77",
		title: "A Book Elsewhere",
		authors: ["Ann Author"],
		isbns: [],
		reading: { state: "reading", fraction: 0.425 },
		seenAt: NOW,
	},
];

function fakeActions(): {
	[K in keyof ReadingSyncActions]: ReturnType<typeof vi.fn> &
		ReadingSyncActions[K];
} {
	return {
		save: vi.fn(async () => ({ status: "ok" as const })),
		setEnabled: vi.fn(async () => ({ status: "ok" as const })),
		setSchedule: vi.fn(async () => ({ status: "ok" as const })),
		reorder: vi.fn(async () => ({ status: "ok" as const })),
		test: vi.fn(async () => ({
			status: "rejected" as const,
			message: "Hardcover rejected the credentials.",
			detail: "HTTP 401",
		})),
		syncNow: vi.fn(async () => ({ status: "already-queued" as const })),
		link: vi.fn(async () => ({ status: "ok" as const })),
		searchEditions: vi.fn(async () => [
			{ id: "ed-1", title: "A Book Elsewhere", authors: ["Ann Author"] },
		]),
	};
}

let container: HTMLDivElement;
let root: Root;
let actions: ReturnType<typeof fakeActions>;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	actions = fakeActions();
});

afterEach(() => {
	act(() => root.unmount());
	document.body.replaceChildren();
});

async function render(providers = [hardcover, bookorbit], books = unmatched) {
	await act(async () =>
		root.render(
			<ReadingSync
				providers={providers}
				unmatched={books}
				actions={actions}
				now={NOW}
			/>,
		),
	);
}

function card(label: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(
		`section[aria-label="${label} reading sync"]`,
	);
	if (!el) throw new Error(`no ${label} card`);
	return el;
}

function button(scope: HTMLElement, name: string): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find(
		(b) => b.textContent === name || b.getAttribute("aria-label") === name,
	);
	if (!found) throw new Error(`no button ${name}`);
	return found;
}

function input(scope: HTMLElement, label: string): HTMLInputElement {
	const el = [...scope.querySelectorAll("label")].find((l) =>
		l.textContent?.startsWith(label),
	);
	const id = el?.getAttribute("for");
	const found = id ? scope.ownerDocument.getElementById(id) : null;
	if (!(found instanceof HTMLInputElement)) throw new Error(`no ${label}`);
	return found;
}

async function type(el: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter?.call(el, value);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function click(el: HTMLElement) {
	await act(async () => el.click());
}

const wait = (ms: number) =>
	act(async () => {
		await new Promise((r) => setTimeout(r, ms));
	});

describe("Reading sync settings", () => {
	it("generates each provider's form from its fields, masking secrets", async () => {
		await render();
		const hc = card("Hardcover");
		const token = input(hc, "API token");
		expect(token.type).toBe("password");
		expect(token.value).toBe("");
		expect(token.placeholder).toBe("Saved, ends in wxyz");
		expect(hc.textContent).toContain(
			"Set, ends in wxyz. Leave blank to keep it.",
		);
		expect(hc.textContent).toContain("From hardcover.app.");
		expect(hc.textContent).toContain(
			"Copy your API token from Hardcover's account settings.",
		);

		const bo = card("BookOrbit");
		expect(input(bo, "Server URL").type).toBe("url");
		expect(input(bo, "KOReader username").type).toBe("text");
		expect(input(bo, "KOReader password").type).toBe("password");
		expect(bo.textContent).toContain("Not set.");
		expect(bo.textContent).toContain("Not set up");
	});

	it("shows the schedule presets, last sync, matched count and last error", async () => {
		await render();
		const hc = card("Hardcover");
		const select = hc.querySelector("select");
		expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
			"Manual only",
			"Every hour",
			"Every 6 hours",
			"Daily",
		]);
		expect(select?.value).toBe("6h");
		expect(hc.textContent).toContain(
			"Last synced 3 hours ago · 12 books matched",
		);
		expect(hc.querySelector('[role="alert"]')?.textContent).toContain(
			"rate limiting",
		);
		expect(card("BookOrbit").textContent).toContain("Not synced yet");

		await act(async () => {
			if (!select) return;
			select.value = "24h";
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(actions.setSchedule).toHaveBeenCalledWith("hardcover", "24h");
	});

	it("saves with a blank secret left blank, and shows a test's reason", async () => {
		await render();
		const hc = card("Hardcover");
		await click(button(hc, "Test connection"));
		expect(actions.test).toHaveBeenCalledWith("hardcover", { token: "" });
		const alert = hc.querySelector('[role="alert"]');
		expect(hc.textContent).toContain("Hardcover rejected the credentials.");
		expect(hc.textContent).toContain("HTTP 401");
		expect(alert).toBeTruthy();

		await type(input(hc, "API token"), "new-token-1234");
		await click(button(hc, "Save"));
		expect(actions.save).toHaveBeenCalledWith("hardcover", {
			token: "new-token-1234",
		});
		// The secret is cleared from the form once saved.
		expect(input(hc, "API token").value).toBe("");
	});

	it("reorders with move up and down", async () => {
		await render();
		expect(button(card("Hardcover"), "Move Hardcover up").disabled).toBe(true);
		expect(button(card("BookOrbit"), "Move BookOrbit down").disabled).toBe(
			true,
		);
		await click(button(card("BookOrbit"), "Move BookOrbit up"));
		expect(actions.reorder).toHaveBeenCalledWith(["bookorbit", "hardcover"]);
		await click(button(card("Hardcover"), "Move Hardcover down"));
		expect(actions.reorder).toHaveBeenLastCalledWith([
			"bookorbit",
			"hardcover",
		]);
	});

	it("toggles a provider and reports why it stays off", async () => {
		actions.setEnabled.mockResolvedValueOnce({
			status: "invalid",
			message: "Fill in BookOrbit's required settings before turning it on.",
		});
		await render();
		const bo = card("BookOrbit");
		const toggle = bo.querySelector<HTMLInputElement>('input[type="checkbox"]');
		expect(toggle?.checked).toBe(false);
		if (toggle) await click(toggle);
		expect(actions.setEnabled).toHaveBeenCalledWith("bookorbit", true);
		expect(bo.textContent).toContain("required settings before turning it on");
	});

	it("starts Sync now only for an enabled provider and says when one is running", async () => {
		await render();
		expect(button(card("BookOrbit"), "Sync now").disabled).toBe(true);
		await click(button(card("Hardcover"), "Sync now"));
		expect(actions.syncNow).toHaveBeenCalledWith("hardcover");
		expect(card("Hardcover").textContent).toContain(
			"A Hardcover sync is already running.",
		);
	});

	it("lists unmatched books under their provider and links one with the picker", async () => {
		await render();
		const hc = card("Hardcover");
		expect(hc.textContent).toContain("A Book Elsewhere");
		expect(hc.textContent).toContain("Ann Author · 42%");
		expect(card("BookOrbit").textContent).not.toContain("A Book Elsewhere");

		await click(button(hc, "Link to a book"));
		await wait(300);
		expect(actions.searchEditions).toHaveBeenCalledWith("A Book Elsewhere");
		const results = hc.querySelector('[aria-label="Matching books"]');
		const pick = results?.querySelector("button");
		expect(pick?.textContent).toContain("A Book Elsewhere");
		if (pick) await click(pick);
		expect(actions.link).toHaveBeenCalledWith("hardcover", "hc-77", "ed-1");
		expect(hc.querySelector('[aria-label="Matching books"]')).toBeNull();
	});
});
