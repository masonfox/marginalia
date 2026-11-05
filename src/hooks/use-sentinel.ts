import { useEffect, useRef } from "react";

/**
 * Calls `onVisible` when the returned element comes within about one screen
 * of the viewport, while `enabled`. Re-arming (enabled turning true again)
 * re-checks visibility, so a short page keeps loading until it fills.
 */
export function useSentinel(onVisible: () => void, enabled: boolean) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el || !enabled) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) onVisible();
			},
			{ rootMargin: "100% 0px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [onVisible, enabled]);
	return ref;
}
