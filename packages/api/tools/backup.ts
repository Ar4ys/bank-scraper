// Usage: node tools/backup.ts <target file>
//
// Writes a consistent copy of the database to the target file while the server keeps running.

import { DatabaseSync } from "node:sqlite";

const [target] = process.argv.slice(2);

if (!target) {
	console.error("Usage: node tools/backup.ts <target file>");
	process.exit(1);
}

const source = process.env.SQLITE_DB_PATH ?? "./local/dev.db";
const db = new DatabaseSync(source);

db.prepare("VACUUM INTO ?").run(target);
db.close();

console.log(`Copied "${source}" to "${target}"`);
