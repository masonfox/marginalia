import { buffer as readAll } from "node:stream/consumers";
import yauzl from "yauzl";
import { EpubError } from "./errors";

/** Default cap on the total uncompressed size of an archive (zip-bomb guard). */
export const DEFAULT_MAX_UNCOMPRESSED_BYTES = 1024 ** 3;

export interface ZipArchive {
	/** Entry names in archive order (directories excluded). */
	readonly names: readonly string[];
	has(name: string): boolean;
	read(name: string): Promise<Buffer>;
	readText(name: string): Promise<string>;
	close(): void;
}

export interface OpenZipOptions {
	maxUncompressedBytes?: number;
}

/**
 * Opens a ZIP archive for random access. Rejects archives that cannot be read,
 * that contain absolute or `..` entry paths, or whose declared uncompressed
 * size exceeds the cap. yauzl also verifies each entry's actual size against
 * its declared size while reading.
 */
export async function openZip(
	source: string | Buffer,
	options: OpenZipOptions = {},
): Promise<ZipArchive> {
	const max = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
	const zipOptions = { lazyEntries: true, autoClose: false };
	let zip: yauzl.ZipFile;
	try {
		zip =
			typeof source === "string"
				? await yauzl.openPromise(source, zipOptions)
				: await yauzl.fromBufferPromise(source, zipOptions);
	} catch (err) {
		throw new EpubError(
			"corrupt",
			`The file is not a readable ZIP archive (${describe(err)})`,
			{ cause: err },
		);
	}

	const entries = new Map<string, yauzl.Entry>();
	let total = 0;
	try {
		await new Promise<void>((resolve, reject) => {
			zip.on("entry", (entry: yauzl.Entry) => {
				const name = entry.fileName;
				const unsafe = yauzl.validateFileName(name);
				if (unsafe) {
					reject(
						new EpubError(
							"unsafe_path",
							`The archive contains an unsafe path: ${name}`,
						),
					);
					return;
				}
				total += entry.uncompressedSize;
				if (total > max) {
					reject(
						new EpubError(
							"too_large",
							`The archive expands to more than ${Math.floor(max / 1024 ** 2)} MB`,
						),
					);
					return;
				}
				if (!name.endsWith("/")) entries.set(name, entry);
				zip.readEntry();
			});
			zip.once("end", resolve);
			zip.once("error", reject);
			zip.readEntry();
		});
	} catch (err) {
		zip.close();
		if (err instanceof EpubError) throw err;
		const message = describe(err);
		if (/relative path|absolute path/i.test(message)) {
			throw new EpubError(
				"unsafe_path",
				`The archive contains an unsafe path (${message})`,
				{
					cause: err,
				},
			);
		}
		throw new EpubError("corrupt", `The ZIP archive is damaged (${message})`, {
			cause: err,
		});
	}

	const read = async (name: string): Promise<Buffer> => {
		const entry = entries.get(name);
		if (!entry)
			throw new EpubError("corrupt", `Missing file in archive: ${name}`);
		try {
			return await readAll(await zip.openReadStreamPromise(entry));
		} catch (err) {
			throw new EpubError(
				"corrupt",
				`Cannot read ${name} from the archive (${describe(err)})`,
				{
					cause: err,
				},
			);
		}
	};

	return {
		names: [...entries.keys()],
		has: (name) => entries.has(name),
		read,
		readText: async (name) => decodeText(await read(name)),
		close: () => zip.close(),
	};
}

/** Decodes UTF-8 (default) or UTF-16 text, dropping a byte-order mark. */
export function decodeText(bytes: Buffer): string {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return new TextDecoder("utf-16le").decode(bytes.subarray(2));
	}
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return new TextDecoder("utf-16be").decode(bytes.subarray(2));
	}
	return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
