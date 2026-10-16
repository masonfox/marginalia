// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingUnit } from "#/modules/catalog";
import { GuideContext, type GuideContextValue } from "./guide";
import { type NoteDraft, NoteEditor } from "./guide-notes";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	update: vi.fn(),
	subjects: vi.fn(),
}));
vi.mock("#/fns/guide", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/fns/guide")>()),
	createNoteFn: mocks.create,
	updateNoteFn: mocks.update,
	listGuideSubjectsFn: mocks.subjects,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-start")>()),
	useServerFn: (fn: unknown) => fn,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const editionId = "00000000-0000-4000-8000-000000000000";
const unit = (ordinal: number, start: number, end: number): ReadingUnit => ({
	ordinal,
	label: `Chapter ${ordinal + 1}`,
	path: [`Chapter ${ordinal + 1}`],
	startPosition: start,
	endPosition: end,
	startLocator: `aaaaaaaaaaaa:v1:${ordinal}.0`,
});
const units = [unit(0, 0, 9), unit(1, 10, 19)];
const listed = (ref: string, name: string) => ({
	ref,
	name,
	kind: "character",
});

/** A stored note anchored at a passage, attached to a subject the list at the bound no longer includes. */
const initial: NoteDraft = {
	title: "Old title",
	body: "Old body.",
	anchor: { kind: "passage", locator: "aaaaaaaaaaaa:v1:1.3" },
	attachment: { kind: "subject", ref: "s:7" },
	sourceConversationId: null,
	subjectName: "Brawne Lamia",
};

describe("NoteEditor", () => {
	let root: ReturnType<typeof createRoot>;
	let container: HTMLDivElement;

	beforeEach(() => {
		mocks.update.mockReset();
		mocks.update.mockResolvedValue({ ok: true, note: {} });
		mocks.subjects.mockResolvedValue({
			ok: true,
			subjects: [listed("k:anna", "Anna"), listed("k:bob", "Bob")],
		});
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		document.body.innerHTML = "";
	});

	async function edit() {
		container = document.createElement("div");
		document.body.append(container);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const guide: GuideContextValue = {
			editionId,
			bound: { choice: { kind: "whole" }, label: null },
			preprocessed: true,
			onStaleBound: () => {},
			units,
			position: null,
		};
		await act(async () => {
			root = createRoot(container);
			root.render(
				createElement(
					QueryClientProvider,
					{ client },
					createElement(
						GuideContext.Provider,
						{ value: guide },
						createElement(NoteEditor, {
							noteId: 5,
							initial,
							units,
							onSaved: () => {},
							onCancel: () => {},
						}),
					),
				),
			);
		});
		// Let the subject list settle.
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
		const form = container.querySelector("[data-testid=note-editor]");
		if (!form) throw new Error("editor not rendered");
		return form as HTMLFormElement;
	}

	/** Sets a field's value the way typing or choosing does, so React sees it. */
	async function change(
		field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
		value: string,
	) {
		const proto = Object.getPrototypeOf(field);
		await act(async () => {
			Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
			field.dispatchEvent(new Event("input", { bubbles: true }));
			field.dispatchEvent(new Event("change", { bubbles: true }));
		});
	}

	const field = <T extends Element>(form: Element, testId: string) => {
		const el = form.querySelector<T>(`[data-testid=${testId}]`);
		if (!el) throw new Error(`no ${testId}`);
		return el;
	};

	async function save(form: HTMLFormElement) {
		await act(async () => {
			field<HTMLButtonElement>(form, "note-save").click();
		});
		expect(mocks.update).toHaveBeenCalledTimes(1);
		return mocks.update.mock.calls[0]?.[0].data;
	}

	it("sends neither the anchor nor the attachment when only the text changed", async () => {
		const form = await edit();
		// The unlisted subject is still shown as chosen, by its stored name.
		const subject = field<HTMLSelectElement>(form, "note-attachment-subject");
		expect(subject.value).toBe("s:7");
		expect(subject.selectedOptions[0]?.textContent).toBe("Brawne Lamia");
		await change(field(form, "note-title"), "New title");
		await change(field(form, "note-body-input"), "New body.");
		expect(await save(form)).toEqual({
			editionId,
			id: 5,
			title: "New title",
			body: "New body.",
		});
	});

	it("sends only the anchor when only the anchor changed", async () => {
		const form = await edit();
		await change(field(form, "note-anchor-passage"), "");
		const whole = form.querySelector<HTMLInputElement>(
			"[data-testid=note-anchor] input[type=radio][value=whole]",
		);
		if (!whole) throw new Error("no end-of-book choice");
		await act(async () => whole.click());
		expect(await save(form)).toEqual({
			editionId,
			id: 5,
			title: "Old title",
			body: "Old body.",
			anchor: { kind: "end" },
		});
	});

	it("sends only the attachment when only the attachment changed", async () => {
		const form = await edit();
		await change(field(form, "note-attachment-subject"), "k:bob");
		expect(await save(form)).toEqual({
			editionId,
			id: 5,
			title: "Old title",
			body: "Old body.",
			attachment: { kind: "subject", ref: "k:bob" },
		});
	});
});
