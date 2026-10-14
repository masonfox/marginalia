import { customType } from "drizzle-orm/pg-core";

/** PostgreSQL text search configuration name, e.g. `english` or `simple`. */
export const regconfig = customType<{ data: string }>({
	dataType: () => "regconfig",
});

export const tsvector = customType<{ data: string }>({
	dataType: () => "tsvector",
});

export const bytea = customType<{ data: Buffer }>({
	dataType: () => "bytea",
});
