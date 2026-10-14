import { useSyncExternalStore } from "react";

const KEY = "marginalia:show-tool-details";
const listeners = new Set<() => void>();

export function readToolDetails(
	storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): boolean {
	try {
		return storage?.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

export function writeToolDetails(
	on: boolean,
	storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage(),
) {
	try {
		if (on) storage?.setItem(KEY, "1");
		else storage?.removeItem(KEY);
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

/** Browser-persisted "Show tool details" preference. Off on the server. */
export function useToolDetails() {
	const on = useSyncExternalStore(
		subscribe,
		() => readToolDetails(),
		() => false,
	);
	return [on, (next: boolean) => writeToolDetails(next)] as const;
}
