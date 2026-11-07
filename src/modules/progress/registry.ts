// The built-in progress providers, keyed by kind.
import { bookorbit } from "./providers/bookorbit";
import { hardcover } from "./providers/hardcover";
import type { ProgressProvider, ProviderKind } from "./types";

export const PROGRESS_PROVIDERS: Readonly<
	Record<ProviderKind, ProgressProvider>
> = {
	bookorbit,
	hardcover,
};

export function getProvider(kind: ProviderKind): ProgressProvider {
	return PROGRESS_PROVIDERS[kind];
}

/** Every built-in provider, in a stable order. */
export function listProviders(): ProgressProvider[] {
	return Object.values(PROGRESS_PROVIDERS);
}
