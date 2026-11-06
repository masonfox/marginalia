// Regenerate browser and installed-app icons from the header's vector mark.
// Run: node scripts/generate-brand-icons.mjs
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const directory = new URL("../public/assets/brand/", import.meta.url);
const svg = await readFile(new URL("logo-mark.svg", directory), "utf8");
const browser = await chromium.launch();
const icons = new Map();
try {
	const page = await browser.newPage({ deviceScaleFactor: 1 });
	for (const size of [16, 32, 48, 180, 192, 512]) {
		await page.setViewportSize({ width: size, height: size });
		await page.setContent(
			`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
		);
		const png = await page.screenshot({ omitBackground: true });
		icons.set(size, png);
		await writeFile(new URL(`icon-${size}.png`, directory), png);
	}
} finally {
	await browser.close();
}
await writeFile(new URL("logo.png", directory), icons.get(512));

// ICO directory entries can embed PNGs, preserving their antialiased alpha.
const sizes = [16, 32, 48];
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
	const png = icons.get(size);
	const entry = 6 + index * 16;
	header[entry] = size;
	header[entry + 1] = size;
	header.writeUInt16LE(1, entry + 4);
	header.writeUInt16LE(32, entry + 6);
	header.writeUInt32LE(png.length, entry + 8);
	header.writeUInt32LE(offset, entry + 12);
	offset += png.length;
}
await writeFile(
	new URL("../public/favicon.ico", import.meta.url),
	Buffer.concat([header, ...sizes.map((size) => icons.get(size))]),
);
