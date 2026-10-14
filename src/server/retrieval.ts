import { createRetrieval, type SearchInput } from "#/modules/retrieval";
import { appContext } from "./context";

/** The UI's search entry point: the same retrieval service other server-side modules use. */
export function runSearch(input: SearchInput) {
	return createRetrieval(appContext().db).search(input);
}
