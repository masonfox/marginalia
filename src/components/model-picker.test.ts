import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelList } from "#/modules/ai";
import type { AiSelection } from "#/server/config";
import { ModelPickerView, modelNotice, priceLabel } from "./model-picker";

const listing: ModelList = {
	models: [
		{
			id: "claude-sonnet",
			name: "Claude Sonnet",
			price: { input: 3, output: 15 },
		},
		{ id: "claude-new", price: null },
	],
};

const render = (value: AiSelection, list?: ModelList) =>
	renderToStaticMarkup(
		createElement(ModelPickerView, {
			providers: ["anthropic", "openai-compatible"],
			value,
			onChange: () => {},
			list,
			onRefresh: () => {},
		}),
	);

describe("modelNotice", () => {
	it("is quiet for a listed id, a blank id, or while loading", () => {
		expect(modelNotice("claude-sonnet", listing)).toBeNull();
		expect(modelNotice(" claude-sonnet ", listing)).toBeNull();
		expect(modelNotice("", listing)).toBeNull();
		expect(modelNotice("anything", undefined)).toBeNull();
	});
	it("flags a typed id that is not in the list", () => {
		expect(modelNotice("my-finetune", listing)).toBe("unlisted");
	});
	it("reports a failed listing instead of an unlisted id", () => {
		expect(modelNotice("my-finetune", { models: [], error: "x" })).toBe(
			"error",
		);
	});
});

describe("ModelPickerView", () => {
	it("offers only the given providers", () => {
		const h = render({ provider: "anthropic", model: "" }, listing);
		expect(h).toContain(">Anthropic</option>");
		expect(h).toContain(">OpenAI-compatible</option>");
		expect(h).not.toContain(">Google</option>");
		expect(h).not.toContain(">OpenAI</option>");
	});

	it("accepts free text: the typed id is kept in a text field, not a fixed list", () => {
		const h = render({ provider: "anthropic", model: "my-finetune" }, listing);
		expect(h).toMatch(/<input[^>]*list="[^"]+"[^>]*value="my-finetune"/);
		expect(h).toContain("<datalist");
		expect(h).toContain('value="claude-sonnet"');
	});

	it("shows the unlisted-model notice for an id not in the provider's list", () => {
		const h = render({ provider: "anthropic", model: "my-finetune" }, listing);
		expect(h).toContain("Not found in Anthropic&#x27;s model list");
		expect(h).not.toContain('role="alert"');
	});

	it("shows no unlisted notice for a listed id, and shows its price", () => {
		const h = render(
			{ provider: "anthropic", model: "claude-sonnet" },
			listing,
		);
		expect(h).not.toContain("Not found");
		expect(h).toContain("$3.00 in · $15.00 out per million tokens");
	});

	it("marks models without a price as unknown", () => {
		const h = render({ provider: "anthropic", model: "claude-new" }, listing);
		expect(h).toContain("Price unknown");
	});

	it("shows a listing error and still accepts a typed id", () => {
		const h = render(
			{ provider: "openai-compatible", model: "llama3" },
			{
				models: [],
				error:
					"Could not load the model list: the provider did not answer in time.",
			},
		);
		expect(h).toContain('role="alert"');
		expect(h).toContain("did not answer in time.");
		expect(h).toContain("You can still type a model id.");
		expect(h).toMatch(/<input[^>]*value="llama3"/);
		expect(h).not.toMatch(/<input[^>]* disabled=""/);
		expect(h).not.toContain("Not found");
	});

	it("ends a listing error without punctuation as a sentence", () => {
		const h = render(
			{ provider: "openai-compatible", model: "" },
			{ models: [], error: "Could not load the model list: fetch failed" },
		);
		expect(h).toContain("fetch failed. You can still type a model id.");
	});

	it("disables every control when disabled", () => {
		const h = renderToStaticMarkup(
			createElement(ModelPickerView, {
				providers: ["anthropic"],
				value: { provider: "anthropic", model: "x" },
				onChange: () => {},
				disabled: true,
			}),
		);
		expect(h).toMatch(/<select[^>]* disabled=""/);
		expect(h).toMatch(/<input[^>]* disabled=""/);
		expect(h).toMatch(/<button[^>]* disabled=""/);
	});
});

describe("priceLabel", () => {
	it("formats a known price and says when it is unknown", () => {
		expect(priceLabel({ input: 0.25, output: 1.25 })).toBe(
			"$0.25 in · $1.25 out per million tokens",
		);
		expect(priceLabel(null)).toBe("Price unknown");
	});
});
