// The built-in progress providers, keyed by kind.
import { bookorbit } from "./providers/bookorbit";
import { e2eFake } from "./providers/e2e-fake";
import { hardcover } from "./providers/hardcover";
import {
	E2E_FAKE_KIND,
	e2eFakeProgressEnabled,
	type ProgressProvider,
	type ProviderKind,
} from "./types";

/** Every registered provider; the e2e fake only when its flag is on. */
export const PROGRESS_PROVIDERS: Readonly<
	Partial<Record<ProviderKind, ProgressProvider>>
> = {
	bookorbit,
	hardcover,
	...(e2eFakeProgressEnabled() ? { [E2E_FAKE_KIND]: e2eFake } : {}),
};

export function getProvider(kind: ProviderKind): ProgressProvider {
	const provider = PROGRESS_PROVIDERS[kind];
	if (!provider) throw new Error(`No progress provider "${kind}"`);
	return provider;
}

/** Every registered provider, in a stable order. */
export function listProviders(): ProgressProvider[] {
	return Object.values(PROGRESS_PROVIDERS).filter(
		(p): p is ProgressProvider => p !== undefined,
	);
}
