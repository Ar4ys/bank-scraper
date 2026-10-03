import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema.ts",
	dialect: "sqlite",
	dbCredentials: { url: `file:${process.env.SQLITE_DB_PATH ?? "./local/dev.db"}` },
});
