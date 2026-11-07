// The built-in progress providers, keyed by kind. Each entry is a placeholder
// until its adapter lands (tasks 8.1, 8.2); replace it in place.
import type { ProgressProvider, ProviderKind } from "./types";

function notImplemented(kind: ProviderKind): never {
	throw new Error(`${kind} progress provider is not implemented`);
}

const bookorbit: ProgressProvider = {
	kind: "bookorbit",
	label: "BookOrbit",
	configFields: [
		{ key: "url", label: "Server URL", type: "url", required: true },
		{ key: "username", label: "Username", type: "text", required: true },
		{ key: "key", label: "Key", type: "secret", required: true },
	],
	testConnection: async () => notImplemented("bookorbit"),
	matching: {
		mode: "lookup",
		keyFor: async () => notImplemented("bookorbit"),
		get: async () => notImplemented("bookorbit"),
	},
};

const hardcover: ProgressProvider = {
	kind: "hardcover",
	label: "Hardcover",
	configFields: [
		{ key: "token", label: "API token", type: "secret", required: true },
	],
	testConnection: async () => notImplemented("hardcover"),
	matching: {
		mode: "list",
		list: async () => notImplemented("hardcover"),
	},
};

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
