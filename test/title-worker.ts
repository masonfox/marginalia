// Separate-process test fixture: real PostgreSQL/pg-boss with a controlled provider.
import { MockLanguageModelV4 } from "ai/test";
import { pino } from "pino";
import type { AiRuntime } from "../src/modules/ai";
import {
	claimTitle,
	dispatchTitles,
	runTitle,
} from "../src/modules/conversation";
import { createDb } from "../src/server/db";
import { JobRuntime } from "../src/server/jobs";

const { db, pool } = createDb(process.env.TITLE_TEST_DATABASE_URL as string);
const log = pino({ level: "silent" });
const model = new MockLanguageModelV4({
	doGenerate: async (options) => {
		const response = await fetch(
			process.env.TITLE_TEST_PROVIDER_URL as string,
			{
				method: "POST",
				body: JSON.stringify({ prompt: options.prompt }),
				signal: options.abortSignal,
			},
		);
		const result = await response.json();
		if (process.env.TITLE_TEST_CRASH === "result") process.exit(92);
		return result;
	},
});
const ai: AiRuntime = {
	available: async () => ["openai" as const],
	resolve: async (selection) => ({
		ok: true as const,
		model,
		selection,
		providerOptions: {},
	}),
	maxSteps: 8,
	temperature: undefined,
	reasoning: undefined,
};
const runtime = await JobRuntime.start({
	connectionString: process.env.TITLE_TEST_DATABASE_URL as string,
	config: { ingestConcurrency: 1, titleConcurrency: 2 },
	log,
	worker: true,
	pollingIntervalSeconds: 0.5,
	retry: { retryDelay: 1, retryDelayMax: 1 },
	handlers: {
		"conversation.title": async ({ conversationId }, ctx) => {
			if (process.env.TITLE_TEST_CRASH === "claimed") {
				if (await claimTitle(db, conversationId)) process.exit(91);
				return;
			}
			await runTitle({ db, ai, log }, conversationId, ctx.signal);
		},
		"conversation.dispatch-titles": async () =>
			dispatchTitles({ db, enqueue: runtime.enqueue }),
	},
	schedules: { "conversation.dispatch-titles": "FREQ=MINUTELY;INTERVAL=1" },
});
await dispatchTitles({ db, enqueue: runtime.enqueue });
process.send?.("ready");
process.on("message", async (message) => {
	if (message === "stop") {
		await runtime.stop(1000);
		await pool.end();
		process.exit(0);
	}
});
