// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProviderCredentialsStatus } from "#/modules/settings";
import {
	CredentialCheckError,
	needsKeyReentry,
	ProviderCredentials,
} from "./provider-credentials";

const value: ProviderCredentialsStatus = {
	provider: "openai",
	configured: true,
	apiKeyHint: "1234",
	baseUrl: "https://provider.test/v1",
	unreadable: false,
};
describe("provider credential controls", () => {
	it("requires key re-entry when a stored-key endpoint changes, including clearing it", () => {
		expect(needsKeyReentry(value, "https://other.test/v1")).toBe(true);
		expect(needsKeyReentry(value, "")).toBe(true);
		expect(needsKeyReentry(value, "https://provider.test/v1/")).toBe(false);
		expect(
			needsKeyReentry({ ...value, apiKeyHint: null }, "https://other.test/v1"),
		).toBe(false);
	});
	it("offers Save anyway only for non-authentication check failures", () => {
		const render = (canSkip: boolean) =>
			renderToStaticMarkup(
				createElement(CredentialCheckError, {
					result: {
						status: "check_failed",
						message: "Provider refused the check",
						canSkip,
					},
					onSaveAnyway: () => {},
				}),
			);
		expect(render(true)).toContain("Save anyway");
		expect(render(false)).not.toContain("Save anyway");
		expect(render(false)).toContain('role="alert"');
	});
	it("shows only the hint and prompts for unreadable keys", () => {
		const html = renderToStaticMarkup(
			createElement(ProviderCredentials, {
				value: { ...value, configured: false, unreadable: true },
				onSave: async () => ({ status: "ok" as const, credentials: value }),
				onRemove: async () => {},
			}),
		);
		expect(html).toContain("ends in 1234");
		expect(html).toContain("Enter the key again");
		expect(html).toContain("Replace key");
		expect(html).toContain("Edit base URL");
		expect(html).toContain("Remove");
		expect(html).not.toContain('type="password"');
	});
});

it("adds, replaces and removes a key without pre-filling it", async () => {
	const target = document.createElement("div");
	document.body.append(target);
	const root = createRoot(target);
	const stored = {
		...value,
		provider: "openai-compatible" as const,
		apiKeyHint: null,
		baseUrl: null,
		configured: false,
	};
	const save = vi.fn(async () => ({
			status: "ok" as const,
			credentials: stored,
		})),
		remove = vi.fn(async () => {});
	const render = async (v: ProviderCredentialsStatus) => {
		await act(async () =>
			root.render(
				createElement(ProviderCredentials, {
					value: v,
					onSave: save,
					onRemove: remove,
				}),
			),
		);
	};
	const click = async (label: string) => {
		const button = [...target.querySelectorAll("button")].find(
			(b) => b.textContent === label,
		);
		if (!button) throw new Error(label);
		await act(async () => button.click());
	};
	const fill = async (selector: string, value: string) => {
		const input = target.querySelector<HTMLInputElement>(selector);
		if (!input) throw new Error(selector);
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, value);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	};
	try {
		await render(stored);
		await click("Add provider");
		expect(
			target.querySelector<HTMLInputElement>('[type="password"]')?.value,
		).toBe("");
		await fill('[type="url"]', "http://localhost:11434/v1");
		await fill('[type="password"]', "disposable-test-key");
		await act(async () => {
			target
				.querySelector("form")
				?.dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				);
		});
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "disposable-test-key",
				baseUrl: "http://localhost:11434/v1",
			}),
		);
		await render({
			...stored,
			configured: true,
			apiKeyHint: "-key",
			baseUrl: "http://localhost:11434/v1",
		});
		await click("Replace key");
		expect(
			target.querySelector<HTMLInputElement>('[type="password"]')?.value,
		).toBe("");
		await fill('[type="url"]', "http://localhost:11435/v1");
		expect(
			target.querySelector<HTMLInputElement>('[type="password"]')?.required,
		).toBe(true);
		expect(
			[...target.querySelectorAll("button")].find(
				(b) => b.textContent === "Save provider",
			)?.disabled,
		).toBe(true);
		await click("Cancel");
		await click("Remove");
		expect(remove).toHaveBeenCalledWith("openai-compatible");
	} finally {
		await act(async () => root.unmount());
		target.remove();
	}
});
