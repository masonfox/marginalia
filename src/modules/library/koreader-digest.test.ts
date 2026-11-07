import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STANDARD_EBOOKS_PATH, standardEbooks } from "../../../test/fixtures";
import {
	KOREADER_DIGEST_OFFSETS,
	koreaderDigest,
	koreaderDigestOfBuffer,
	koreaderDigestOfHandle,
} from "./koreader-digest";

// Expected digests come from an independent Perl transliteration of KOReader's
// util.partialMD5 that emulates LuaJIT bit.lshift (5-bit shift count, 32-bit result):
//   for i in -1..10: seek(lshift(1024, 2i)); read 1024; stop on empty read; md5 concat.

/** Deterministic bytes: byte k = (31k + 7) mod 256. */
const pattern = (length: number) => {
	const bytes = Buffer.alloc(length);
	for (let k = 0; k < length; k++) bytes[k] = (k * 31 + 7) & 0xff;
	return bytes;
};

const cases: { name: string; bytes: () => Buffer; digest: string }[] = [
	{
		name: "Standard Ebooks EPUB fixture (654,844 bytes)",
		bytes: standardEbooks,
		digest: "6288df95b8306cd5a545efa33d2596b9",
	},
	{
		name: "5,000,000-byte pattern reaching the 4 MiB sample",
		bytes: () => pattern(5_000_000),
		digest: "4448bc4b5b98051a0a8f767b1d69ebcb",
	},
	{
		name: "1,500-byte pattern with a short second sample",
		bytes: () => pattern(1_500),
		digest: "af9c96c4a71b9d281d66b79ec8281c1b",
	},
	{
		name: "file under 1 KiB",
		bytes: () => Buffer.from("hello koreader"),
		digest: "2a592fa79c469072b718c01efb1933c0",
	},
	{
		name: "empty file",
		bytes: () => Buffer.alloc(0),
		digest: "d41d8cd98f00b204e9800998ecf8427e",
	},
];

describe("KOReader partial MD5", () => {
	let dir: string;
	beforeAll(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "koreader-digest-"));
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("samples LuaJIT lshift(1024, 2i) offsets, where i = -1 overflows to 0", () => {
		expect(KOREADER_DIGEST_OFFSETS).toEqual([
			0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864,
			268435456, 1073741824,
		]);
	});

	it.each(cases)("matches the reference digest: $name", async ({
		bytes,
		digest,
	}) => {
		const data = bytes();
		expect(koreaderDigestOfBuffer(data)).toBe(digest);

		const file = path.join(dir, `${digest}.bin`);
		await writeFile(file, data);
		expect(await koreaderDigest(file)).toBe(digest);

		const handle = await open(file, "r");
		try {
			expect(await koreaderDigestOfHandle(handle)).toBe(digest);
		} finally {
			await handle.close();
		}
	});

	it("reads the committed fixture by path", async () => {
		expect(await koreaderDigest(STANDARD_EBOOKS_PATH)).toBe(
			"6288df95b8306cd5a545efa33d2596b9",
		);
	});

	it("hashes a file under 1 KiB as the MD5 of its whole content", () => {
		const small = Buffer.from("hello koreader");
		expect(koreaderDigestOfBuffer(small)).toBe(
			createHash("md5").update(small).digest("hex"),
		);
	});
});
