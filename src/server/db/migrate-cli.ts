// Applies migrations and exits: `pnpm db:migrate`.
import { getConfig } from "../config";
import { getLogger } from "../logger";
import { createDb } from ".";
import { migrateOrExit } from "./migrate";

const { pool } = createDb(getConfig().databaseUrl, 1);
await migrateOrExit(pool, getLogger());
await pool.end();
