import fs from "node:fs";
import path from "node:path";

const migrationsPath = path.join(import.meta.dirname, "../drizzle");

for (const migrationDir of fs.readdirSync(migrationsPath)) {
	const migration = path.join(migrationsPath, migrationDir, "migration.sql");
	if (!fs.existsSync(migration)) continue;

	let sql = fs.readFileSync(migration, "utf8");

	// turn the closing `);` of CREATE TABLE statements into `) STRICT, WITHOUT ROWID;`
	sql = sql.replace(/(CREATE TABLE [^;]+?)\)\s*;/gs, "$1) STRICT, WITHOUT ROWID;");

	fs.writeFileSync(migration, sql);
	console.log(`Added "STRICT, WITHOUT ROWID" to "${migrationDir}"`);
}
