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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./dropdown-menu";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	// Radix's popper measures its anchor; jsdom has no ResizeObserver.
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	document.body.replaceChildren();
});

const render = () =>
	act(() =>
		root.render(
			<DropdownMenu>
				<DropdownMenuTrigger>Actions</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem>Rename</DropdownMenuItem>
					<DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>,
		),
	);

const trigger = () => {
	const button = document.querySelector<HTMLButtonElement>(
		'[data-slot="dropdown-menu-trigger"]',
	);
	if (!button) throw new Error("no trigger");
	return button;
};

const press = async (key: string) => {
	trigger().focus();
	await act(async () => {
		trigger().dispatchEvent(
			new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
		);
	});
};

const items = () =>
	[...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);

describe("DropdownMenu", () => {
	it("renders a closed menu button", () => {
		render();
		expect(trigger().textContent).toBe("Actions");
		expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it.each([
		"Enter",
		" ",
		"ArrowDown",
	])("opens from the keyboard with %j", async (key) => {
		render();
		await press(key);
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		expect(document.querySelector('[role="menu"]')).not.toBeNull();
		expect(items()).toEqual(["Rename", "Delete"]);
	});

	it("closes on Escape and returns focus to the trigger", async () => {
		render();
		await press("Enter");
		const menu = document.querySelector('[role="menu"]');
		await act(async () => {
			menu?.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		// Radix restores focus in a timeout after the menu unmounts.
		await vi.waitFor(() => expect(document.activeElement).toBe(trigger()));
	});
});
