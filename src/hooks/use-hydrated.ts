import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during SSR and hydration, true once the client has hydrated. */
export function useHydrated() {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	);
}
