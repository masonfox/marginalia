import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getNamingMetadataFn } from "#/fns/conversations";
import { NamingPoller, type TrackedTitle } from "#/lib/naming-poller";

export const namingPoller = new NamingPoller(
	(ids, signal) => getNamingMetadataFn({ data: { ids }, signal }),
	() =>
		typeof document !== "undefined" && document.visibilityState !== "hidden",
);
let mounts = 0;
function reconcile() {
	namingPoller.reconcile();
}
export function beginNamingTracking(id: string) {
	namingPoller.begin(id);
}
export function namingRenamed(id: string, title: string) {
	namingPoller.renamed(id, title);
}

/** Patches metadata only, keeping router pages, streaming messages and drafts intact. */
export function useNamingMetadata<T extends TrackedTitle>(
	source: T,
): T & { deleted?: boolean } {
	const currentSource = useRef(source);
	currentSource.current = source;
	const sourceId = source.id;
	const subscribe = useCallback(
		(listener: () => void) =>
			namingPoller.subscribe(
				{ ...currentSource.current, id: sourceId },
				listener,
			),
		[sourceId],
	);
	const snapshot = useCallback(() => namingPoller.get(source.id), [source.id]);
	const patch = useSyncExternalStore(subscribe, snapshot, () => null);
	useEffect(() => {
		namingPoller.seed(source);
	}, [source]);
	useEffect(() => {
		if (mounts++ === 0) {
			window.addEventListener("focus", reconcile);
			window.addEventListener("online", reconcile);
			document.addEventListener("visibilitychange", reconcile);
		}
		return () => {
			if (--mounts === 0) {
				window.removeEventListener("focus", reconcile);
				window.removeEventListener("online", reconcile);
				document.removeEventListener("visibilitychange", reconcile);
			}
		};
	}, []);
	if (patch === undefined && namingPoller.isDeleted(source.id))
		return { ...source, deleted: true };
	if (
		!patch ||
		(source.naming?.revision ?? -1) > patch.naming.revision ||
		(source.naming?.locked && !patch.naming.locked)
	)
		return source;
	// Loader data at the same revision may have newer reply usage. Preserve it.
	if ((source.naming?.revision ?? -1) === patch.naming.revision)
		return { ...source, title: patch.title, naming: patch.naming };
	return { ...source, ...patch };
}
