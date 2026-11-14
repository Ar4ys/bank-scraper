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
	/**
	 * Base URL of Sure, without `/api/v1`, for reading its categories. Merchants get no categories
	 * without it and `SURE_API_KEY`.
	 */
	SURE_API_URL: z
		.url({ protocol: /^https?$/ })
		.transform((url) => url.replace(/\/+$/, ""))
		.optional(),
	/** API key of Sure with read scope, sent as `X-Api-Key` */
	SURE_API_KEY: z.string().nonempty().optional(),
});

export const config = configSchema
	.refine((env) => (env.SURE_API_URL === undefined) === (env.SURE_API_KEY === undefined), {
		message: "Set both SURE_API_URL and SURE_API_KEY, or neither",
	})
	.parse(process.env);
