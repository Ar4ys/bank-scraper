import { z } from "zod";

const configSchema = z.object({
	/** Address the HTTP server listens on */
	HTTP_HOST: z.string().default("127.0.0.1"),
	/** Port the HTTP server listens on */
	HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8585),
	/** Path of the SQLite database file, relative to the working directory */
	SQLITE_DB_PATH: z.string().default("./local/dev.db"),
	/** Key the userscript has to send to store scraped transactions */
	INGEST_API_KEY: z.string().nonempty(),
	/** Key Sure has to send to read accounts and transactions through the Lunch Flow API */
	LUNCHFLOW_API_KEY: z.string().nonempty(),
	/** Directory of the built admin app, relative to the working directory. Not served if missing. */
	ADMIN_APP_DIR: z.string().default("../admin/dist"),
	/**
	 * Built userscript, served for installing and updating it, relative to the working directory. Not
	 * served if missing.
	 */
	USERSCRIPT_PATH: z.string().default("../userscript/dist/userscript.js"),
	/** Git commit of the running build, recorded with every transaction version */
	APP_GIT_COMMIT: z.string().default("unknown"),
});

export const config = configSchema.parse(process.env);
