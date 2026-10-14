import path from "node:path/posix";

/** Resolves an href found in `fromFile` to a normalized archive path, splitting off the fragment. */
export function resolveHref(
	fromFile: string,
	href: string,
): { path: string; fragment: string | null } {
	const hashAt = href.indexOf("#");
	const rawPath = hashAt >= 0 ? href.slice(0, hashAt) : href;
	const rawFragment = hashAt >= 0 ? href.slice(hashAt + 1) : null;
	const target = rawPath
		? path.normalize(path.join(path.dirname(fromFile), safeDecode(rawPath)))
		: fromFile;
	return {
		path: target.replace(/^\.\//, ""),
		fragment: rawFragment ? safeDecode(rawFragment) : null,
	};
}

/** True for hrefs that leave the publication (http:, mailto:, …). */
export function isExternalHref(href: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
