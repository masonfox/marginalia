// Runs `node <args>` with local development settings loaded from
// .env.development: this checkout's own file if it has one, otherwise the
// main checkout's, so git worktrees need no copy. Variables already set in the
// environment take precedence. Relative paths in path settings resolve against
// the file's folder, so worktrees share the main checkout's data directory
// (which matches the database they share).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const FILE = ".env.development";
/** Settings holding paths; MARGINALIA_LIBRARY_PATHS is comma-separated. */
const PATH_SETTINGS = ["MARGINALIA_DATA_DIR", "MARGINALIA_LIBRARY_PATHS"];

/** The main checkout's folder, or null outside a git repository. */
function mainCheckout() {
	try {
		const commonDir = execFileSync(
			"git",
			["rev-parse", "--path-format=absolute", "--git-common-dir"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		return path.dirname(commonDir);
	} catch {
		return null;
	}
}

function findEnvFile() {
	const local = path.resolve(FILE);
	if (existsSync(local)) return local;
	const main = mainCheckout();
	const shared = main && path.join(main, FILE);
	if (shared && existsSync(shared)) {
		console.error(`Using ${shared}`);
		return shared;
	}
	return null;
}

const resolvePaths = (value, dir) =>
	value
		.split(",")
		.map((p) => p.trim())
		.map((p) => (p === "" ? p : path.resolve(dir, p)))
		.join(",");

const env = { ...process.env };
const file = findEnvFile();
if (file) {
	const dir = path.dirname(file);
	for (const [key, value] of Object.entries(
		parseEnv(readFileSync(file, "utf8")),
	)) {
		if (key in process.env) continue;
		env[key] = PATH_SETTINGS.includes(key) ? resolvePaths(value, dir) : value;
	}
}

const child = spawn(process.execPath, process.argv.slice(2), {
	env,
	stdio: "inherit",
});
// The terminal already signals the child; this covers signals sent to us alone.
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 1));
