import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type Database = NodePgDatabase;
/** A database handle or an open transaction. */
export type Executor = Pick<
	Database,
	"select" | "selectDistinct" | "insert" | "update" | "delete" | "execute"
>;

export interface DbHandle {
	db: Database;
	pool: pg.Pool;
}

export function createDb(connectionString: string, max = 10): DbHandle {
	const pool = new pg.Pool({ connectionString, max });
	return { db: drizzle({ client: pool }), pool };
}
