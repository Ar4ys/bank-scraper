import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";

import { relations } from "./relations.ts";

export * as tables from "./schema.ts";

export const db = drizzle("file:./local/dev.db", { relations });

export async function initSQLite() {
	db.run(sql`
		-- SQLite allows only one writer at a time. This timeout allows multiple
		-- writers to wait for a db lock instead of instantly failing with "SQLITE_BUSY"
		PRAGMA busy_timeout = 5000;
		-- Enforce foreign key constraints
		PRAGMA foreign_keys = ON;
		-- Use a write-ahead log instead of a rollback journal to implement transactions
		PRAGMA journal_mode = WAL;
		-- Better performance when tied with "journal_mode = WAL"
		PRAGMA synchronous = NORMAL;
		-- Better performance when tied with "journal_mode = WAL"
		PRAGMA temp_store = MEMORY;
		-- More cache = Better performance
		PRAGMA cache_size = -64000;
	`);

	const { foreign_keys } = db.get<{ foreign_keys: number }>(
		"PRAGMA foreign_keys;",
	);

	if (foreign_keys !== 1) {
		throw new Error("SQLite foreign_keys pragma failed to enable");
	}
}
