import { type DestinationStream, type Logger, pino } from "pino";
import { getConfig } from "./config";

export type { Logger };

/**
 * Creates a JSON logger. Fields commonly holding secrets are redacted as a
 * second line of defence; code should still never log them.
 */
export function createLogger(
	level: string,
	destination?: DestinationStream,
): Logger {
	return pino(
		{
			level,
			base: { app: "marginalia" },
			timestamp: pino.stdTimeFunctions.isoTime,
			redact: {
				paths: [
					"password",
					"authPassword",
					"*.password",
					"*.authPassword",
					"req.headers.cookie",
					'res.headers["set-cookie"]',
				],
				censor: "[redacted]",
			},
		},
		destination,
	);
}

let root: Logger | undefined;

/** The process-wide logger, configured by LOG_LEVEL. */
export function getLogger(): Logger {
	root ??= createLogger(getConfig().logLevel);
	return root;
}
