import type { AccessDeps } from "#/modules/access";
import type { AiRuntime } from "#/modules/ai";
import type { Config } from "./config";
import type { Database } from "./db";
import type { CancelJob, Enqueue, PendingJob } from "./jobs/kinds";
import type { Logger } from "./logger";

/**
 * Process-wide services, set once by `boot()`. Modules read them here instead
 * of importing the boot code, which would create import cycles.
 */
export interface AppContext {
	config: Config;
	log: Logger;
	db: Database;
	ai: AiRuntime;
	enqueue: Enqueue;
	pendingJob: PendingJob;
	cancelJob: CancelJob;
	access: AccessDeps;
}

const key = Symbol.for("marginalia.context");
const store = globalThis as { [key]?: AppContext };

export function setAppContext(ctx: AppContext): void {
	store[key] = ctx;
}

export function appContext(): AppContext {
	const ctx = store[key];
	if (!ctx) throw new Error("Marginalia services are not started");
	return ctx;
}
