import { LoginRateLimiter, setupPassword } from "#/modules/access";
import { createAi } from "#/modules/ai";
import {
	type Config,
	ConfigError,
	loadConfig,
	redactedConfig,
	runsWorker,
} from "./config";
import { type AppContext, setAppContext } from "./context";
import { createDb } from "./db";
import { migrateOrExit } from "./db/migrate";
import { everyMinutes, JobRuntime } from "./jobs";
import { jobHandlers } from "./jobs/handlers";
import { createLogger, type Logger } from "./logger";

const key = Symbol.for("marginalia.boot");
const store = globalThis as { [key]?: Promise<AppContext> };

/**
 * Starts the process-wide services once: config, logging, migrations (under an
 * advisory lock, exiting non-zero on failure), the job queue, and startup
 * tasks. Safe to call repeatedly (e.g. on dev-server reloads).
 */
export function boot(): Promise<AppContext> {
	store[key] ??= start();
	return store[key];
}

async function start(): Promise<AppContext> {
	const config = loadConfigOrExit();
	const log = createLogger(config.logLevel);
	log.info({ config: redactedConfig(config) }, "starting marginalia");

	const { db, pool } = createDb(config.databaseUrl);
	await migrateOrExit(pool, log);

	const password = await setupPassword(db, config.authPassword, log);
	const access = {
		db,
		password,
		limiter: new LoginRateLimiter(),
		sessionDays: config.sessionDays,
		trustProxy: config.trustProxy,
		publicUrl: config.publicUrl,
	};

	const worker = runsWorker(config);
	const jobs = await JobRuntime.start({
		connectionString: config.databaseUrl,
		config,
		log,
		worker,
		handlers: jobHandlers(),
		schedules: {
			"library.scan": everyMinutes(config.scanIntervalMinutes),
			"access.purge-sessions": "0 4 * * *",
		},
	});

	const ai = createAi(config.ai);
	const ctx: AppContext = {
		config,
		log,
		db,
		ai,
		enqueue: jobs.enqueue,
		access,
	};
	setAppContext(ctx);
	await onStarted(ctx, log);

	installShutdown(log, async () => {
		await jobs.stop();
		await pool.end();
	});
	return ctx;
}

async function onStarted(ctx: AppContext, log: Logger) {
	if (ctx.config.libraryPaths.length > 0 && runsWorker(ctx.config)) {
		await ctx.enqueue("library.scan", {});
		log.info(
			{ roots: ctx.config.libraryPaths },
			"startup library scan enqueued",
		);
	}
}

function loadConfigOrExit(): Config {
	try {
		return loadConfig(process.env);
	} catch (err) {
		if (err instanceof ConfigError) {
			process.stderr.write(`${err.message}\n`);
			process.exit(1);
		}
		throw err;
	}
}

function installShutdown(log: Logger, stop: () => Promise<void>) {
	let stopping = false;
	const handler = (signal: NodeJS.Signals) => {
		if (stopping) return;
		stopping = true;
		log.info({ signal }, "shutting down; waiting for running jobs");
		stop()
			.then(() => {
				log.info("shutdown complete");
				process.exit(0);
			})
			.catch((err) => {
				log.error({ err }, "shutdown failed");
				process.exit(1);
			});
	};
	process.once("SIGTERM", handler);
	process.once("SIGINT", handler);
}
