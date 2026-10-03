import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/node-sqlite/migrator";

export const testIngestApiKey = "test-ingest-key";
export const testLunchflowApiKey = "test-lunchflow-key";

/**
 * Points `db` at a fresh, migrated SQLite file in a temp directory and sets the rest of the
 * environment the app needs. Call it before anything imports `db.ts` or `config.ts`, so modules
 * that depend on them have to be imported dynamically afterwards.
 */
export async function createTestDb() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bank-scraper-test-"));
	process.env.SQLITE_DB_PATH = path.join(dir, "test.db");
	process.env.INGEST_API_KEY = testIngestApiKey;
	process.env.LUNCHFLOW_API_KEY = testLunchflowApiKey;

	const { db, initSQLite } = await import("./db.ts");
	await initSQLite();
	migrate(db, { migrationsFolder: path.join(import.meta.dirname, "../../drizzle") });

	return {
		db,
		cleanup: () => {
			db.$client.close();
			fs.rmSync(dir, { recursive: true });
		},
	};
}
