import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.join(import.meta.dirname, "../..");

/**
 * Points `db` at a fresh SQLite file in a temp directory and creates the tables of `schema.ts` in
 * it. Call it before anything imports `db.ts`, so modules that depend on `db` have to be imported
 * dynamically afterwards.
 *
 * The tables come from `drizzle-kit export`, not from the migrations, so they lack the `STRICT,
 * WITHOUT ROWID` that `tools/patchMigrations.ts` adds.
 */
export async function createTestDb() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bank-scraper-test-"));
	process.env.SQLITE_DB_PATH = path.join(dir, "test.db");

	const ddl = execFileSync(
		path.join(projectRoot, "node_modules/.bin/drizzle-kit"),
		["export", "--sql"],
		{ cwd: projectRoot, encoding: "utf8" },
	);

	const { db, initSQLite } = await import("./db.ts");
	await initSQLite();
	db.$client.exec(ddl);

	return {
		db,
		cleanup: () => {
			db.$client.close();
			fs.rmSync(dir, { recursive: true });
		},
	};
}
