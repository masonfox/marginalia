import { useEffect, useState } from "react";

/** Whether the primary input is touch, where Enter inserts a newline. */
export function useCoarsePointer() {
	const [coarse, setCoarse] = useState(false);
	useEffect(() => {
		const query = window.matchMedia("(pointer: coarse)");
		setCoarse(query.matches);
		const change = () => setCoarse(query.matches);
		query.addEventListener("change", change);
		return () => query.removeEventListener("change", change);
	}, []);
	return coarse;
}
