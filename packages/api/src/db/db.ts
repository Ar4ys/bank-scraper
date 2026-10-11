import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";

import { config } from "../config.ts";
import { relations } from "./relations.ts";

export * as tables from "./schema.ts";

export const db = drizzle(`file:${config.SQLITE_DB_PATH}`, { relations });

/** Runs `fn` in a transaction, or as a part of the one that is already open */
export function inTransaction(fn: () => void) {
	if (db.$client.isTransaction) fn();
	else db.transaction(fn);
}

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

	const { foreign_keys } = db.get<{ foreign_keys: number }>("PRAGMA foreign_keys;");

	if (foreign_keys !== 1) {
		throw new Error("SQLite foreign_keys pragma failed to enable");
	}
}
