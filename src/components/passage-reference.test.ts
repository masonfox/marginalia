import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingUnit } from "#/modules/catalog";
import { PassageReferenceMenu } from "./passage-reference";
import { PassageUnitNote, unitsForPassage } from "./scope";

const router = createRouter({
	routeTree: createRootRoute(),
	history: createMemoryHistory(),
});

// These tests are plain .ts, so children go through props rather than JSX.
const wrap = (children: ReactNode) =>
	renderToStaticMarkup(
		createElement(QueryClientProvider, {
			client: new QueryClient(),
			// biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
			children: createElement(RouterContextProvider, { router, children }),
		}),
	);

const openMenu = (aiEnabled: boolean) =>
	wrap(
		createElement(PassageReferenceMenu, {
			passageRef: { locator: "aaaaaaaaaaaa:v1:3.4" },
			editionId: "ed1",
			revealPosition: 40,
			aiEnabled,
			defaultOpen: true,
			// biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
			children: createElement("button", { type: "button" }, "Reference"),
		}),
	);

const items = (html: string) =>
	[...html.matchAll(/role="menuitem"[^>]*>(.*?)<\/div>/g)].map((m) =>
		(m[1] as string).replace(/<[^>]+>/g, ""),
	);

describe("PassageReferenceMenu", () => {
	it("offers copy, a new conversation, and an existing one with AI", () => {
		expect(items(openMenu(true))).toEqual([
			"Copy link",
			"Discuss in a new conversation",
			"Add to a conversation",
		]);
	});

	it("offers only Copy link without AI", () => {
		expect(items(openMenu(false))).toEqual(["Copy link"]);
	});

	it("names the menu's trigger as a menu button", () => {
		expect(openMenu(true)).toMatch(
			/<button[^>]*aria-haspopup="menu"[^>]*>Reference<\/button>/,
		);
	});
});

const unit = (ordinal: number, endPosition: number): ReadingUnit => ({
	ordinal,
	label: `Chapter ${ordinal + 1}`,
	path: [`Chapter ${ordinal + 1}`],
	startPosition: ordinal * 10 + 1,
	endPosition,
	startLocator: `aaaaaaaaaaaa:v1:${ordinal}.0`,
});
const units = [unit(0, 10), unit(1, 20), unit(2, 30)];

describe("scope choices for a passage", () => {
	it("offers the unit containing the passage and later ones", () => {
		expect(unitsForPassage(units, 15)).toEqual({
			units: [units[1], units[2]],
			containing: units[1],
		});
		// A passage at a unit's last position is in that unit.
		expect(unitsForPassage(units, 10).containing).toBe(units[0]);
	});

	it("offers no unit for a passage after the last one", () => {
		expect(unitsForPassage(units, 31)).toEqual({ units: [], containing: null });
	});

	it("names the containing unit", () => {
		expect(
			renderToStaticMarkup(
				createElement(PassageUnitNote, { label: "Chapter 9" }),
			),
		).toContain("This passage is in Chapter 9.");
	});
});
