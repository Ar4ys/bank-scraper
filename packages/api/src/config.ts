import { z } from "zod";

const configSchema = z.object({
	/** Address the HTTP server listens on */
	HTTP_HOST: z.string().default("127.0.0.1"),
	/** Port the HTTP server listens on */
	HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8585),
	/** Path of the SQLite database file, relative to the working directory */
	SQLITE_DB_PATH: z.string().default("./local/dev.db"),
});

export const config = configSchema.parse(process.env);
