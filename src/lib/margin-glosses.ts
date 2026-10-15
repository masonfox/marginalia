import { useSyncExternalStore } from "react";

const KEY = "marginalia:margin-glosses";
const listeners = new Set<() => void>();

/** Whether margin glosses are on: on unless the reader turned them off. */
export function readMarginGlosses(
	storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): boolean {
	try {
		return storage?.getItem(KEY) !== "0";
	} catch {
		return true;
	}
}

export function writeMarginGlosses(
	on: boolean,
	storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage(),
) {
	try {
		if (on) storage?.removeItem(KEY);
		else storage?.setItem(KEY, "0");
	} catch {
		// Storage unavailable: the preference just won't persist.
	}
	for (const l of listeners) l();
}

function safeStorage(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

function subscribe(cb: () => void) {
	listeners.add(cb);
	window.addEventListener("storage", cb);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", cb);
	};
}

/**
 * Browser-persisted margin glosses preference. Off on the server: glosses
 * are fetched in the browser, once the preference is known.
 */
export function useMarginGlosses() {
	const on = useSyncExternalStore(
		subscribe,
		() => readMarginGlosses(),
		() => false,
	);
	return [on, (next: boolean) => writeMarginGlosses(next)] as const;
}
