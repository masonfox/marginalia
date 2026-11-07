import { createHash } from "node:crypto";
import { type FileHandle, open } from "node:fs/promises";

// KOReader's document identity: util.partialMD5 in frontend/util.lua.
// It samples 1 KiB at offsets `bit.lshift(1024, 2*i)` for i = -1..10 and
// hashes the concatenation, stopping at the first sample past EOF.
//
// LuaJIT's bit.lshift masks the shift count to 5 bits and returns a 32-bit
// result, so i = -1 is `1024 << 30`, which overflows to 0, not 256. Every
// sync server that interoperates with KOReader (kosync, Kavita, Booklore,
// JS `1024 << -2`) agrees on 0, so the first sample is the file head.
const SAMPLE_SIZE = 1024;
const SAMPLE_STEP = 1024;

/** Sample offsets in read order, matching LuaJIT `bit.lshift(1024, 2*i)` for i = -1..10. */
export const KOREADER_DIGEST_OFFSETS: readonly number[] = Array.from(
	{ length: 12 },
	(_, k) => SAMPLE_STEP << (2 * (k - 1)),
);

/** KOReader partial MD5 of in-memory bytes, as lowercase hex. */
export function koreaderDigestOfBuffer(bytes: Uint8Array): string {
	const md5 = createHash("md5");
	for (const offset of KOREADER_DIGEST_OFFSETS) {
		if (offset >= bytes.length) break;
		md5.update(bytes.subarray(offset, offset + SAMPLE_SIZE));
	}
	return md5.digest("hex");
}

/** KOReader partial MD5 read from an open file handle, as lowercase hex. */
export async function koreaderDigestOfHandle(
	handle: FileHandle,
): Promise<string> {
	const md5 = createHash("md5");
	const sample = Buffer.alloc(SAMPLE_SIZE);
	for (const offset of KOREADER_DIGEST_OFFSETS) {
		let filled = 0;
		while (filled < SAMPLE_SIZE) {
			const { bytesRead } = await handle.read(
				sample,
				filled,
				SAMPLE_SIZE - filled,
				offset + filled,
			);
			if (bytesRead === 0) break;
			filled += bytesRead;
		}
		if (filled === 0) break;
		md5.update(sample.subarray(0, filled));
	}
	return md5.digest("hex");
}

/** KOReader partial MD5 of the file at `path`, as lowercase hex. */
export async function koreaderDigest(path: string): Promise<string> {
	const handle = await open(path, "r");
	try {
		return await koreaderDigestOfHandle(handle);
	} finally {
		await handle.close();
	}
}
